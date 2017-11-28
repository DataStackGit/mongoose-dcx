var dcxLib=require("./dcxlib");
var _=require("underscore");
var extend=require("node.extend");
var async = require("async");
var mongooseSync = require("../mongoose-sync");
var dcxLibs={};

function Transport(config) {
	this.name="dcx";
	this.init(config);
}

Transport.prototype.init = function(config) { 
	if (config && !this.dcxLib) {
		if (!dcxLibs[config.host]) dcxLib[config.host]=new dcxLib(config);
		this.dcxLib = dcxLib[config.host];
		this.config=config;
	}
}
// sync returns unique ID in third-party storage
Transport.prototype.getId = function(retrivedDoc) { 
	return this.dcxLib.getDocumentId(retrivedDoc)
}
// sync returns Modified Timestamp or hash in third-party storage
Transport.prototype.getModified = function(retrivedDoc) { 
	return this.dcxLib.getDocumentId(retrivedDoc)
}

// sync returns Deleted flag from third-party storage reply
Transport.prototype.getDeleted = function(retrivedDoc) {
	return this.dcxLib.isDeleted(retrivedDoc) 
}

// needs for Writeable third-party destinantions
Transport.prototype.syncOut = function(modelName, syncInfo, fieldsmap, callback)  {
	console.log("syncOut for ", syncInfo, Object.keys(fieldsmap));
	syncInfo = syncInfo || {};
	if (!_.isObject(this.config.classToDocMap[modelName]) ) return callback(new Error("Class "+modelName+" can't be syncronized to "+this.name))
  var docMap=extend(true, {}, this.config.docBase, this.config.classToDocMap[modelName]);
	var linksEnabled=docMap["$links"];
	var isCreate  = !!(syncInfo && syncInfo.extId);
	var binary = (isCreate?false:fieldsmap['$file']);
	if (fieldsmap['$binary_update_path']) var binary_update_path = fieldsmap['$binary_update_path'];

	fieldsmap=_.omit(fieldsmap, ["$links", "$file", '$binary_update_path']);

	var attachments=[];
	for (var key in fieldsmap) {
		if (["created", "modcount", "modified"].indexOf(key)>=0) continue;
		if (!binary && linksEnabled && (key in linksEnabled)) {
			if (_.isArray(fieldsmap[key])) {
        let position = 1;
        attachments = attachments.concat(fieldsmap[key].map(function (link) {
          return {slot: linksEnabled[key], linkId: link, position: position++}
        }));
        // attachments = attachments.concat(fieldsmap[key].map(function (link) { return {slot: linksEnabled[key], linkId: link} }));
      } else
				attachments.push({ slot:linksEnabled[key], linkId:fieldsmap[key] } );
			continue;
		}
		if (key=="$body") docMap.body=fieldsmap[key];
		else docMap.head[key]=fieldsmap[key];
	}
	var that=this;
	that.dcxLib.auth(function(err) {
		if (err) return callback(err);

    if (isCreate) {
      that.dcxLib.getDocument(syncInfo.extId, function (err, doc) {
        if (modelName === 'Image') {
          if (that.dcxLib.isDeleted(doc) || (err && err.code === 404)) {
            that.dcxLib.putImage(binary_update_path, docMap, function(err, res, isNewUpload, id) {
              if (err || !res) return callback(err || new Error("Undefiend sync result for binary syncOut to "+that.name)  );
              var reply={ extId:that.dcxLib.getDocumentId(res), extModified:that.dcxLib.getDocumentModified(res), duplicate:!isNewUpload };
              console.log(res, reply);
              callback(null, reply);
            })
          } else {
            var reply={ extId:that.dcxLib.getDocumentId(doc), extModified:that.dcxLib.getDocumentModified(doc), duplicate:false };
            callback(null, reply);
          }
        }
        if (modelName === 'Subject') {
          if (that.dcxLib.isDeleted(doc) || (err && err.code === 404)) {
            that.dcxLib.putDocument(null, docMap, function(err, res, id) {
              if (err || !res) return callback(err || new Error("Undefiend sync result for document syncOut to "+that.name)  )
              var docId=that.dcxLib.getDocumentId(res);
              async.each(attachments, function(attach, next) {
                  that.dcxLib.linkToStory(attach.linkId, docId, attach.slot || "default", attach.position, next);
                },
                function(err) {
                  callback(err, { extId:docId,  extModified:that.dcxLib.getDocumentModified(res) })
                });
            })
          }
        }
      })
    } else if (binary) {
			that.dcxLib.putImage(binary, docMap, function(err, res, isNewUpload, id) {
				if (err || !res) return callback(err || new Error("Undefiend sync result for binary syncOut to "+that.name)  );
				var reply={ extId:that.dcxLib.getDocumentId(res),  extModified:that.dcxLib.getDocumentModified(res), duplicate:!isNewUpload };
				console.log(res, reply)
				callback(null, reply);
			})
		} else that.dcxLib.putDocument(syncInfo.extId, docMap, function(err, res, id) {
				if (err || !res) return callback(err || new Error("Undefiend sync result for document syncOut to "+that.name)  )
				var docId=that.dcxLib.getDocumentId(res);
				async.each(attachments, function(attach, next) {
					that.dcxLib.linkToStory(attach.linkId, docId, attach.slot || "default", attach.position, next);
				},
				function(err) {
					callback(err, { extId:docId,  extModified:that.dcxLib.getDocumentModified(res) })
				});
			})
	})
}

// needs for Readable third-party sources
Transport.prototype.syncIn = function(modelName, since, callback) {
	console.error("TODO: abstract syncIn method for "+this.name+" transport");
}

mongooseSync.registerTransport("dcx", new Transport() );

module.exports=Transport;