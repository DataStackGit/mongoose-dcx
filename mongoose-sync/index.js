var mongoose = require('mongoose');
var	Schema = mongoose.Schema;
var _ = require("underscore");
var async = require("async");
var transports = {};

/**
	options
	-------
		transport:String - name of registered /or object of/ transport
		autoCreate:Boolean - enable object creating in local storage at SyncIn operation
		autoDelete:Boolean - enable object deleting in local storage at SyncIn operation

	model statics
	-------------
		mapFromSync(incomingObject, foundOrCreatedMongooseObject, callback)

	model methods
	-------------
		mapToSync(transport, action, callback)
		saveSyncOutResults(transport, result, callback) - optional // For extra storing result of syncronizations

	transport
	---------
		name:String
		syncOut = function(modelName, liskInfo, fieldsmap, callback)  // for Writeable
		syncIn = function(modelName, since, callback)		 // for Readable

		getId = function(retrivedDoc) return retrivedDoc.extId;
		getModified = function(retrivedDoc) return retrivedDoc.extModified;
		getDeleted = function(retrivedDoc) return retrivedDoc.isDeleted;

*/

module.exports.SyncPlugin = function (schema, options) {
	if (!options) throw new Error("Sync plugin options are required");
	if (!options.transport) throw new Error("Sync plugin options.transport is required");
	var syncName=_.isObject(options.transport)?options.transport.name:options.transport;
	transport=getTransport(options.transport);
	if (!transport || !syncName) throw new Error("Sync plugin unknown transport "+syncName);
	
	// TODO check transport interface
	
	var isFirstPlugin=!schema._sync;
	if (isFirstPlugin) {
		schema._sync = {};
		schema.add({sync:{type: Schema.Types.Mixed,  _id:false}});

	};
	schema._sync[syncName]=transport;
	schema.paths.sync[syncName]={extId: String, extModified: String, syncModified: Date };
	var indx={};
		indx["sync."+syncName+".extId"]=1
		schema.index(indx);

	if (!isFirstPlugin) return;
	
	schema.methods.extId = function(syncName) {
		if (!this.sync || !this.sync[syncName]) return false;
		return this.sync[syncName].extId;
	}

	schema.methods.syncOut = function(to, extraData, done) {
		if (!done && _.isFunction(to)) {
			done=to;
			to=undefined;
		  extraData={};
		}
    if (_.isFunction(extraData) && !done) {
      done=extraData;
		  extraData={};
		}
		if (to && to.name) to=to.name;
		var _transports={}; 
		if (to && transports[to]) _transports[to]=transports[to];
		else _transports=transports;

		if (!_.isFunction(this.mapToSync) ) {
			console.warn(this.constructor.modelName+" not ready for external sync mapping. See mapToSync method");
			return done(new Error(this.constructor.modelName+" not ready for external sync mapping. See mapToSync method"));
		};
		var that=this;
		that.sync = that.sync || {};
		
		async.eachOf(_transports, function(transport, dest, oneDone) {
			var action=(!that.sync[syncName] || !that.sync[syncName].extId)?"create":"update";
			if (!_.isFunction(transport.syncOut)) {

				console.warn("Transport for SyncOut ("+dest+") havn't .syncOut method (may be ReadOnly?)", transport )
				return oneDone();
			}
			that.mapToSync(transport, action, extraData, function(err, map){
				transport.syncOut(that.constructor.modelName, that.sync[dest], map, function(err, result) {
					if (err) { 
						console.error(err);
						return oneDone(err);
					};
					that.sync[dest]=result
          that.markModified('sync');
					/* .extId=_.isFunction(transport.getId)?transport.getId(result):result.id
					that.sync[dest].extModified=_.isFunction(transport.getModified)?transport.getModified(result) || (that.modified || new Date()).toISOString();
					that.sync[dest].modified=that.modified; */
					if (_.isFunction(that.saveSyncOutResults))
						that.saveSyncOutResults(transport, result, oneDone);
					else
						oneDone();
				})
			})
		}, function(e) {
			done(e, that);
		});
	}
  schema.statics.syncInBinary = function(from, options, done) {
  	var transport=schema._sync[from];
    // console.log("TRANSPORT:", transport);
    if (!transport) return done(new Error("Unknown transport for SyncIn "+from));
    if (!_.isFunction(transport.getBinary)) return done(new Error("Transport for SyncIn ("+from+") havn't .syncIn method (may be WriteOnly?)"));
    transport.getBinary(options, done);
  }
  
  schema.statics.syncIn = function(from, options, done) {
    if (!done && _.isFunction(options)) {
      done=options;
      options={};
    }
    options = options || {};
    if (!_.isFunction(this.mapFromSync)) {
      console.warn(this.modelName+" not ready for external sync mapping. See mapFromSync method");
      return done( new Error(this.modelName+" not ready for external sync mapping. See mapFromSync method") );
    }
    var transport=schema._sync[from];
    // console.log("TRANSPORT:", transport);
    if (!transport) return done(new Error("Unknown transport for SyncIn "+from));
    if (!_.isFunction(transport.syncIn)) return done(new Error("Transport for SyncIn ("+from+") havn't .syncIn method (may be WriteOnly?)"));

    var that=this;
    transport.syncIn(this.modelName, options, function(err, list) {
      if (err) return done(err);
      if (!list || !list.length) return done();
      async.mapSeries(list, function(one, oneDone) {
        var extId =_.isFunction(transport.getId)?transport.getId(one):one.id;
        if (!extId) extId = one.uuid;
        // console.log("ONE:", JSON.stringify(one, null, 2));
        if (!extId) { console.warn("Undefined exteranl Id", one); return oneDone(); }
        var extModified =_.isFunction(transport.getModified)?transport.getModified(one):false;
        var filter = {};
        filter["sync."+from+".extId"] = extId;
        console.log("EXTID:", extId);
        that.findOne(filter, function(err, existsOne) {
          if (extModified && existsOne && existsOne.sync && existsOne.sync[from] && (existsOne.sync[from].extModified==extModified))
            return oneDone(null, existsOne);
          if (existsOne && _.isFunction(transport.isDeleted)) {
            if (transport.isDeleted(one)) {
              if (options.autoDelete) {
                existsOne.remove(oneDone);
              } else {
                existsOne.sync[from]={syncModified:new Date()};
                existsOne.save(oneDone);
              }
              return;
            }
          }
          existsOne=(existsOne || options.autoCreate?(new that()):null);
          if (!existsOne) return oneDone();
          that.mapFromSync(one, existsOne, function(err, data) {
            if (err) return oneDone(err);

            // WTF?
            data.project = options.projectId;
            data.organization = options.organizationId;
            data.sync=one.sync || {};
            data.sync[from] = one.sync?one.sync[from]?one.sync[from]:{}:{};
            data.sync[from].extId=extId;
            data.sync[from].extModified= extModified || (that.modified || new Date()).toISOString();
            data.sync[from].syncModified = new Date();
            data.save(oneDone)
          });
        })
      }, done);
    });
  };

}

function getTransport(transportOrName) {
	if (_.isObject(transportOrName) && transportOrName.name) return transportOrName;
	if (_.isString(transportOrName))
		return transports[transportOrName];
}

function registerTransport(name, transport) {
	if (!transport && _.isObject(name)) {
		transport=name;
		name=transport.name;
	}
	if (!name) throw new Error("Registering Mongoose-Sync Transport name is emptpy");
	if (!_.isObject(transport) ) throw new Error("Registering Mongoose-Sync Transport not a Object");
	if (!transport.name) throw new Error("Registering Mongoose-Sync Object not a Transport (.name is undefined)");
	if (!_.isFunction(transport.syncOut) && !_.isFunction(transport.syncIn) )
		throw new Error("Registering Mongoose-Sync Object not a Transport (syncIn & syncOut methods is not a Functions)");
	transports[name]=transport;
}


module.exports.initTransport = function(name, config) {
	var T=getTransport(name);
	if (T) T.init(config);
}
module.exports.registerTransport = registerTransport;
module.exports.getTransport = getTransport;