var util = require('util');
var fs = require('fs-extra');
var request = require('request');
var _ = require('underscore');
var striptags= require("striptags");

// require('request').debug = true;
var xml2js = require('xml2js');
var parseXML = xml2js.parseString;
var objPath = require("object-path");
var LOG_INFO  =0;
var LOG_ERR =1;
var LOGLEVEL = LOG_ERR;

function _log() {
	var args = Array.prototype.slice.call(arguments);
	var level=args.slice(0, 1);
	if (level<LOGLEVEL) return;
	console.log.apply(console, arguments);
}
/*
	config
	--------
		host - хост сервера архива
		urlPrefix - префикс пути к API сервера default="/dcx_mkrf/atom"
		pubInfoId - идентификатор статуса использования
		uploadPathSuffix - путь к папке для загрузки бинарей
		user
		password
		cookieStorageFileName
*/

function dcxAPI(config) {
	this.config=config;
	this.config.urlPrefix = this.config.urlPrefix || "/dcx_mkrf/atom";
	this.authData = {user: this.config.user, pass:this.config.password };
	this._readCookie();
	
}

dcxAPI.prototype._readCookie=function() {
	if (this.config.cookieStorageFileName) 
		try {
			this.authData.cookie=fs.readJSONSync(this.config.cookieStorageFileName);
		} catch(e) { }
}
dcxAPI.prototype._writeCookie=function() {
	if (this.config.cookieStorageFileName && this.authData.cookie) 
		try {
			fs.writeJSONSync(this.config.cookieStorageFileName, this.authData.cookie, {encoding:"utf8"})
		} catch(e) { }
}
dcxAPI.prototype._api= function(options, callback) {
	if (_.isString(options)) {
		options={url:options};
	}
	if(!_.isObject(options) || !_.isString(options.url)) return callback({code:500, messasge:"Unknown request params or URL"});
	var that=this;
	var opts=_.extend({}, options);
	
	opts.url=opts.url.indexOf("://")<0?(that.config.host+this.config.urlPrefix+options.url):options.url;

	opts.method=options.method || "POST";
	opts.jar="jar" in options?options.jar:that._getCookie();
	opts.headers="headers" in opts?opts.headers:{'Content-Type': 'application/atom+xml;type=entry' };

	if (_.isObject(opts.body) || _.isArray(opts.body) ) { 
		var builder = new xml2js.Builder();
		opts.body=builder.buildObject(options.body);
	}
	console.log( (opts.method || "GET")+ " "+opts.url);
	request(opts, function(err, res, body) {
		if (err || !res) {
			_log(LOG_ERR, "ERR:_api", err);
			if (err.code == "EHOSTUNREACH") {
				if (typeof(options.attempt) == 'undefined') {
						options.attempt = 0;
				}
				if (options.attempt < 10) {
					options.attempt += 1;
					setTimeout(function(){ that._api(options, callback); }, 2000);
				}
			}
			return;
		};

		if (res.statusCode>399) {
			var err= {code:res.statusCode, messasge:body};
			_log(LOG_ERR, "ERR:_api", err, opts, res.caseless.dict);
			callback(err, null);
			return;	
		};
		_log(LOG_INFO, "VMALIB:_api: ", body, res.caseless.dict);
		callback(null, res, body);	
	});
};

dcxAPI.prototype._getCookie = function(cookie) {
	cookie = cookie || this.authData.cookie;
	var jar = request.jar();
	var param = request.cookie(cookie.param);
	jar.setCookie(param, cookie.url);
	_log(LOG_INFO, "VMALIB:_getCookie: ", param)
	return jar;
}

dcxAPI.prototype._parseXMLTpl = function(templ, callback) {
	
	_log(LOG_INFO, "Get File: ", __dirname + '/xml_templ/' + templ);

	fs.readFile(__dirname + '/xml_templ/' + templ, 'utf-8', function(err, xml) {
		if (err || !xml) {
			_log(LOG_ERR, "ERR:_parseXMLTpl", err, xml)
			return callback(err,  {});	
		}
		parseXML(xml, function(err, obj) {
			if (err || !obj) {
				_log(LOG_ERR, "ERR:_parseXMLTpl:parse", err, xml)
				return callback(err,  {});	
			}
			_log(LOG_INFO,"VMALIB:_parseXMLTpl: ", obj)
			callback(null, obj);
		});
	});
}
dcxAPI.prototype._docUrl = function(res) {
	return res.caseless.dict.location
}

dcxAPI.prototype._docId = function(res) {
	var loc=this._docUrl(res);
	return loc.split("/").pop();
}

dcxAPI.prototype._sendFile = function (path, callback) {
	if (!fs.existsSync(path)) {
		_log(LOG_ERR, "ERR:_sendFile:File not found", path);
		callback(new Error('File not found'));
		return;
	}
	var count = 0;
	
	var opts = {
		url: '/upload/'+this.config.uploadPathSuffix, // /mkrf_uploadconfig_exibit_ar
		headers:{},
		formData: {
			'file[input][]': fs.createReadStream(path)
		}
	}
	var that=this;
	that._api(opts, function(err, res, body) {
		if (err) return callback(err, null);	
		_log(LOG_INFO, "VMALIB:_sendFile: ", res.caseless.dict);

		var location = that._docUrl(res);
		var check_load_interval = setInterval(function() {
			that._api({'url': location, method:"GET", headers:{}}, function(err, res, xml) {
				if (err) return callback(err, null, 0);	
					
				parseXML(xml, function(err, result) {
					if (err || !result) {
						_log(LOG_ERR, "ERR:_sendFile:parse_xml", err, result)
						return callback(err, null, 0);	
					}
					var status = result.entry.job[0]['status'][0];
					if (status == 3 || status == 4) {
						clearInterval(check_load_interval);
						var image_id = objPath.get(result, "entry.job.0.objects.0.document.0.$.id");
						_log(LOG_INFO, "VMALIB:_sendFile: ", image_id+(status==4?" ALREADY EXSIST ":"") );
						callback(null, image_id, status);
					} else {
						if (count < 30) {
							count++;
						} else {
							clearInterval(check_load_interval);
							_log(LOG_ERR, "ERR:_sendFile:Image not load");
							callback(new Error('Image not load'), null, 0);
						}
					}
				});
			});
		}, 3000);
	});
}

dcxAPI.prototype._updateStatus = function(id, status, callback) {
	var that= this;
	that.getDocument(id, function(err, obj) {
		if (err || !obj) return callback(err, null);
		var status_id = objPath.get(obj, 'entry.document.0.task.0.$.href', "").split('/')[4];
		that.getDocument(status_id, function(err, obj) {
			if (err || !obj) return callback(err, null);
			objPath.set(obj, 'entry.document.0.head.0.TaskStatus.0.$', {'topic': status} )
			// Object.defineProperty(obj['entry']['document'][0]['head'][0]['TaskStatus'][0], '$', {'value': {'topic': status}, 'enumerable': true});
			that._updateDocument(status_id, obj, function(err, obj, id) {
				if (err) return callback(err, null);	
				_log(LOG_INFO, "VMALIB:_updateStatus: OK");
				callback(null, obj, id);
			});
		});
	});
}

	/*
	var get_pub_info = function(id, callback) {
		var jar = _getCookie();
		var opts = {
			'url': 'https://dc.mkrf.ru/dcx_mkrf/atom/pubinfos?q[doc_id]=' + id,
			'jar': jar
		}

		that._api(opts, function(err, res, body) {
			if (err) {
				callback(null, err, null);	
				return;
			}  
			_log(LOG_INFO,"VMALIB:get_pub_info: ", res);
			callback(null, null, res);
			
		});
	}
		attached_to_story
		story_documents
	*/
dcxAPI.prototype._updatePubInfo = function(id, type, callback) {
	var that=this;
	that._parseXMLTpl('updatePubInfo.xml', function(err, obj) {
		if (err || !obj) {
			_log(LOG_ERR, "ERR:_updatePubInfo", err, res);
			return callback(err, null);	
		} 
		objPath.set(obj, 'entry.pubinfo.0.type_id.0.$', {'id': type} )
		objPath.set(obj, 'entry.pubinfo.0.publication_id.0.$', {'id': that.config.pubInfoId} );
		// Object.defineProperty(obj['entry']['pubinfo'][0]['type_id'][0], '$', {'value': {'id': type}, 'enumerable': true});
		// Object.defineProperty(obj['entry']['pubinfo'][0]['publication_id'][0], '$', {'value': {'id': type}, 'enumerable': true});
		that._api({'url': '/pubinfos?q[doc_id]=' + id, 'body': obj}, function(err, res, body) {
			if (err) return callback(err, null);	
			_log(LOG_INFO, "VMALIB:_updatePubInfo: ", body);
			parseXML(body, function(err, obj) { callback(null, obj, id); }) ;
		});
	});
}

dcxAPI.prototype._createDocument = function(meta, callback) {
	var that=this;
	that._parseXMLTpl('createDocument.xml', function(err, obj) {
		if (err || !obj) {
			_log(LOG_ERR, "ERR:createDocument:_parseXMLTpl", err, obj)
			callback(err, null);	
			return;
		}
		that._setMeta(meta, obj, function(err, obj) {
			var opts = { 'url': '/documents/',
				'body': obj
			}
			/* console.log("VMALIB:createDocument:with meta : ",util.inspect(obj,{depth:8}));
			
			var builder = new xml2js.Builder();
			console.log("body:", builder.buildObject(opts.body));
			return callback( new Error("WTF") );
			*/

			that._api(opts, function(err, res, body) {
				if (err)return callback(err, null);	

				_log(LOG_INFO,"VMALIB:createDocument:_setMeta: ", body);
				var id = that._docId(res);
				parseXML(body, function(err, reply) { 
					if (err) return callback(err, null);	
					that._updatePubInfo(id, 'pubtype-article', function(err1, result) {
						if (that.config.storyStatus)
							that._updateStatus(id, that.config.storyStatus, function(err2, result) { /// TODO: taskstatus-done
								_log(LOG_INFO, "VMALIB:createDocument: ", id);
								callback(err1 || err2, reply, id);
							});
						else callback(err1, reply, id);
					});
				});
			});
		});
	});
}
dcxAPI.prototype._updateDocument = function (id, obj, callback) {
	this._api({'url':'/document/' + id, 'method': 'PUT','body': obj }, function(err, res, body) {
			if (err) return callback(err, null);	
			_log(LOG_INFO,"VMALIB:updateDocument: ", body);
			parseXML(body, function(err, reply) { 
				console.log("VMALIB:updateDocument: reply", reply, body, err)
				if (err) return callback(err, null);
				callback(null, reply, id);
			});

	});
}

dcxAPI.prototype._setMeta = function(meta, obj, callback) {
	for (var i in meta.head) {
		var val=meta.head[i];
		if (!_.isArray(meta.head[i])) {
			if (typeof meta.head[i] == 'string') val=[val];
			else {
				var param = {};
				if (val && val['_']) {
					param['_'] = val['_'];
					val=_.omit(val, '_');
				}
				param['$'] = val;
				val=param;
				// Object.defineProperty(obj['entry']['document'][0]['head'][0], i, {'value': [param], 'enumerable': true});
			}
		}
		objPath.set(obj, 'entry.document.0.head.0.'+i, val);
	}
	if (meta.pool_id) {
		// objPath.del(obj, "entry.document.0.pool_id");
		objPath.set(obj, "entry.document.0.pool_id", meta.pool_id);
	}
	if (meta.body) {
		 var xml = '<section><p>' + meta.body.replace(/\<br\s*\/\>/gmi, '</p><p>') + '</p></section>';
		try {
		parseXML(xml, function(err, body) {
			if (err || !body) {
				body=striptags(xml, [], "\n")
			}
			objPath.set(obj, "entry.document.0.body.0.section", body.section || body)
			objPath.del(obj, "entry.document.0.body.0.p");
			// Object.defineProperty(obj['entry']['document'][0]['body'][0], "section", {'value': body.section, 'enumerable': true});
			// delete obj['entry']['document'][0]['body'][0]["p"];
			// console.log("_setMeta.document.body ++++++++++++++++++++++++++++")
			// console.log(JSON.stringify(obj['entry']['document'][0]['body'][0]));
		});
		return callback(null, obj);;
	} catch(e) {
		callback(e, null);	
	};
	}
	else callback(null, obj);


}

// ==================================================================
//							exports
// ==================================================================

dcxAPI.prototype.auth = function(data, callback) {
	if (!callback  && _.isFunction(data)) {
		callback=data;
		data=undefined;
	};

	if (!_.isObject(data)) data=this.authData;
	else {
		data.user=data.user || this.authData.user;
		data.pass=data.pass || this.authData.pass;
		data.cookie = this.authData.cookie;
	}
	/* if (this.authData && this.authData.cookie) data=_.extend(data, {cookie:this.authData.cookie} );
		{ var tmp_cookie = authData.cookie;
		authData=data;
		if (tmp_cookie) authData.cookie = tmp_cookie; 
	}*/
	
	if (!data.user || !data.pass) {
		var err = {code:401, message:"Empty user or password"};
		_log(LOG_ERR, "ERR:getDocument:parse_xml", err)
		callback(err, null);
	};
	var that=this;
	_log(LOG_INFO, "VMALIB:Auth: starting");
	var jar = request.jar();
	var opts = {
		url: '',
		jar: jar,
		method:"GET",
		headers:{},
		auth: {
			user: data.user,
			pass: data.pass,
			sendImmediately: true
		}
	};
	if (data.cookie) {
		opts.auth.cookie=data.cookie;
	}

	that._api(opts, function(err, res, body) {
		if (err) {
			callback(err, null);
			return;
		}
		var cookie = {
			'param': jar.getCookieString(that.config.host+that.config.urlPrefix),
			'url': that.config.host+that.config.urlPrefix
		};
		_log(LOG_INFO, "VMALIB:Auth: ", cookie.param);
		that.authData.cookie = cookie;
		that._writeCookie();
		callback(null, that.authData);
	});
}
dcxAPI.prototype.isDeleted = function (obj, index) {
	index = index || "0";
	var isDeleted=objPath.get(obj, 'entry.document.'+index+'.pool_id.0.$.id') // pool_id: [ { '$': { id: 'trashcan' } } ]
	_log(LOG_INFO,"Document deleted=", isDeleted=='trashcan');
	return isDeleted =='trashcan';
}
dcxAPI.prototype.getDocumentId = function(obj, index) {
	index = index || "0";
	return objPath.get(obj, 'entry.document.'+index+'.$.id');
}
dcxAPI.prototype.getDocumentModified = function(obj, index) {
	index = index || "0";
	return objPath.get(obj, 'entry.document.'+index+'.modified.0');
}

dcxAPI.prototype.getDocument = function (id, callback) {
	if (!id) return callback({stats:400, message:"Not correct docId"});
	var that=this;
	var opts = {
		url: '/document/' + id,
		method:"GET",
		headers:{}
	};

	that._api(opts, function(err, res, xml) {
		if (err) {
			callback(err, null);	
			return;
		}
		_log(LOG_INFO, "==== got doc", xml);

		parseXML(xml, function(err, obj) {
			if (err || !obj) {
				_log(LOG_ERR, "ERR:getDocument:parse_xml", err, xml)
				callback(err, null);	
			} else {
				_log(LOG_INFO, "VMALIB:getDocument: ", obj)
				callback(null, obj);
			}
		});
	});
}



dcxAPI.prototype.putDocument = function (id, meta, callback) {
	var that = this;
	that.getDocument(id, function(err, obj) {
		if (err || !obj) {
			that._createDocument(meta, function(err, garbage, id){
		 		if (err) return callback(err);
				// console.log("Updated", err)
				that.getDocument(id, function(err, obj) {
					callback(err, obj, id);
				});
			})
		} else {
			that._setMeta(meta, obj, function(err, obj) {
				// console.log("Meta sets", err)
				if (err) return callback(err);
				that._updateDocument(id, obj, function(err){
					if (err) return callback(err);
					// console.log("Updated", err)
					that.getDocument(id, function(err, obj) {
						callback(err, obj, id);
					});
				});
			});
		};
	});
}

dcxAPI.prototype.putImage = function(path, meta, callback) {
	_log(LOG_INFO,"VMALIB:uploadFile: ", path);
	var that=this;
	that._sendFile(path, function(err, id, status) {
		function _reply(err, isNew) {
			if (err) return callback(err);
			that.getDocument(id, function(err, obj) {
				callback(err, obj, id, isNew);
			});
		}

		if (err) return callback(err);
    if (status === '3') {
      that.getDocument(id, function(err, obj) {
        if (err) return callback(err);
        meta.head['ObjectName'] = 'Фотография';
        _log(LOG_INFO, "VMALIB:uploadFile:getDocument SUCCESS with meta", meta);
        // objPath.del(meta, "pool_id"); // Kostyl'
        that._setMeta(meta, obj, function(err, newdoc) {
          console.log("VMALIB:uploadFile:_setMeta:", err?err:"SUCCESS");
          that._updateDocument(id, newdoc, function(err) {
            if (err) return callback(err, obj, id);
            _log(LOG_INFO, "VMALIB:uploadFile:updateDocument:", err?err:"SUCCESS");
            // if (status==3)
              that._updatePubInfo(id, 'pubtype-image', function(err, result) {
                _reply(err, true);
              });
            // else
            //   _reply(err, false);
          });
        });
      });
    } else
      _reply(null, false)
	});
}



dcxAPI.prototype.linkToStory = function(doc_id, story_id, slot, position, callback) {
	var that=this;
	that._parseXMLTpl('documentToStory.xml', function(err1, obj) {
		if (err1) return callback(err1);	
		objPath.set(obj,'entry.pubinfo.0.doc_id.0.$', {id: doc_id});
		objPath.set(obj,'entry.pubinfo.0.story_doc_id.0.$', {id: story_id});
		// Object.defineProperty(obj['entry']['pubinfo'][0]['doc_id'][0], '$', {'value': {'id': doc_id}, 'enumerable': true});
		// Object.defineProperty(obj['entry']['pubinfo'][0]['story_doc_id'][0], '$', {'value': {'id': story_id}, 'enumerable': true});
		if (slot) {
			objPath.set(obj, 'entry.pubinfo.0.info.0.template', [{slot:[{name:slot || "default", position:position || "1"}]}]);
			//obj['entry']['pubinfo'][0]['info'][0]['template']=[{}];
			//obj['entry']['pubinfo'][0]['info'][0]['template'][0]['slot']=[{}];
			//obj['entry']['pubinfo'][0]['info'][0]['template'][0]['slot'][0]['name']=slot.name || "default";
			//obj['entry']['pubinfo'][0]['info'][0]['template'][0]['slot'][0]['position']=slot.position || "1";
			if (slot.title) {
				objPath.set(obj, 'entry.pubinfo.0.info.0.storyobjectfields', [{'title':slot.title}] )
				// obj['entry']['pubinfo'][0]['info'][0]['storyobjectfields']=[{'title':slot.title}];
			}
		}
		var opts = {
			'url': '/pubinfos',
			'body': obj
		}
		that._api(opts, function(err, res, body) {
			if (err)  return callback(err);	
			_log(LOG_INFO, "VMALIB:documentToStory: ", body);
			parseXML(body, function(err, obj) { 
				if (err) return callback(err, null);
				callback(null, obj, doc_id);
			});
		});
	});
}




module.exports = dcxAPI
// ------------ cut off from exports --------------- 
	// _parseXMLTpl: _parseXMLTpl,
	// _sendFile: _sendFile,
	//	get_pub_info: get_pub_info,
	// _updatePubInfo: _updatePubInfo,
