var _ = require("underscore");
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;
var config  = require("./config.js");

var mongooseSync=require("../R/mongoose-sync");
var SyncDCX=require("../R/mongoose-sync-dcx");


var aSchema = new Schema({
	
});

	if (config.DCX) {
		mongooseSync.initTransport("dcx", config.DCX);
		aSchema.plugin(mongooseSync.SyncPlugin, { transport:"dcx" } );
	};


// Sync plugin syncOut mapping
	aSchema.methods.mapToSync = function(transport, action, extraData, callback) {
	var map={
		"title.ru":"Title",
		"description.ru":"$body",
		"keywords":"Keywords",
		"URL":"URI",
		"project.title.ru":"TitleOfCollection"
	};

/* 
moved to properties
-------------------
FullTitle
SizeWeight
RegistrationStateNum
NumberInventory
MaterialTechnique
TechniqueNote
CreatedDate
City
ArchiveLocation
Address */
		// console.log(this.get("description.ru"))
		var that= this;
		this.populate("project topImage gallery properties.key", function(err, that){
			if (err) return callback(err);
			var res={};
			for(var key in map) {
				var v=that.get(key);
				if (v) res[map[key]]=v;
				else res[map[key]]=""
			}
      if (res['$body']) {
        res['$body'] = res['$body']
          .replace(/\#\d+/mg, "\n")
          .replace(/<div[^>]+data-placeholder=("Автор"|"Название"|"Подпись к картинке"|"Подпись к галерее")[^>]+>.*?<\/div>/mg, "\n")
          .replace(/<span>.+?(jpg|png)<\/span>/mg, "\n")
          .replace(/(<([^>]+)>)/mg, "\n")
          .split("\n").filter(function (a) {
          if (a && a !== " ") return true
        }).map(function (a) {
          return "<p>"+a+"</p>"
        }).join("");
			}

			if (that.properties)
				that.properties.forEach(function(p){
					if (p.key.archKey && p.lang=="ru" && p.value)
						res[p.key.archKey]=p.value;
				});
				
			if (that.topImage && _.isFunction(that.topImage.syncOut)) {
				that.topImage.syncOut(transport, res, function(err){
					// console.log("mapToSync.topImage", that.topImage.sync);
					res.topImage=that.topImage.sync[transport.name].extId;
					res.gallery=[];
					async.each(that.gallery, function(img, nextOne){
						img.syncOut(transport, res, function(err){
							// console.log("mapToSync.gallery", img.sync);
							var eId=img.sync[transport.name]?img.sync[transport.name].extId:null;
							if (eId) res.gallery.push(eId);
							nextOne()
						});
					}, 
					function(){ 
						// console.log("mapToSync", res);
						callback(null, res); 
					})
				})
			} else {
				// console.log("mapToSync", res);
				callback(null, res); 
			} 
			// console.log("mapToSync", JSON.stringify(res, null, 2) );
			// callback(null, res);
		})
	}

  aSchema.statics.mapFromSync = function(one, existsOne, callback) {
    let map={
      "title": "title",
      "description": "description",
    };

    var that = this;
    async.series([
      function(seriesCallback) {
        if (one.content[0].images) {
          var Image = mongoose.model("Image");
          async.eachSeries(one.content[0].images, function (iziImage, eachCallback) {
            // console.log("https://media.izi.travel/"+one.content_provider.uuid+'/'+iziImage.uuid+"_1600x1200.jpg");
            that.syncInBinary("izi", {content_provider:one.content_provider.uuid, uuid:iziImage.uuid, type: 'image'}, function(err, imgFile) {
            	if (err) eachCallback(err);
	            Image.createFromUrl("file:/"+imgFile, {}, function(err, img) {
	              if (err) eachCallback(err);
	              img.save(function (err, img) {
	                if (err) eachCallback(err);
	                if (!existsOne.topImage) {
	                  existsOne.topImage = img;
	                  existsOne.images.push(img);
	                  eachCallback()
	                } else {
	                  existsOne.images.push(img);
	                  eachCallback()
	                }
	              })
	            })
	        })
          }, function (err) {
            if (err) seriesCallback(err);
            else seriesCallback()
          })
        } else seriesCallback();
      },
      function(seriesCallback) {
        if (Object.keys(one.audio).length > 0) {
          async.eachOf(one.audio, function (value, key, eachCallback) {
            var Audio = mongoose.model("Audio");
            that.syncInBinary("izi", {content_provider:one.content_provider.uuid, uuid:value, type: 'audio'}, function(err, aFile) {
	            Audio.createFromUrl("file:/"+aFile, {}, function (err, audio) {
	              if (err) eachCallback(err);
	              audio.save(function (err, audio) {
	                if (err) eachCallback(err);
	                existsOne.audio[key] = audio;
	                eachCallback()
	              })
	            })
	          })
          }, function (err) {
            if (err) seriesCallback(err);
            else seriesCallback()
          })
        } else seriesCallback();
      }],
      function(err, results) {
        if (err) callback(err);

        var author;
        var title;
        var image;
        var text;
        var description;

        one.locales.forEach(function (locale) {
          for(let key in map) {
            if (key === 'title') {
              if (objectPath.has(one, key)) {
                author = objectPath.get(one, 'title.'+locale).split('.')[0].split(' ');
                if (objectPath.get(one, 'title.'+locale).includes('«') && objectPath.get(one, 'title.'+locale).includes('»')) {
                  title = objectPath.get(one, 'title.'+locale).split('«')[1].split('»')[0];
                  existsOne.set('title.'+locale, title);
                  existsOne.properties.push({key: "58b4280761a1dd5e4f1cb8fc", locale: locale, value:title});
                } else {
                  existsOne.set('title.'+locale, objectPath.get(one, 'title.'+locale));
                  existsOne.properties.push({key: "58b4280761a1dd5e4f1cb8fc", locale: locale, value:objectPath.get(one, 'title.'+locale)});
                }
                if (author.length<=4 && author.length>=2 && !author.includes('в') && !author.includes('Симпозиум') && !author.includes('Менины'))  {
                  existsOne.set('author.'+locale, author.join(' '));
                  existsOne.properties.push({key: "58b4281061a1dd5e4f1cb8fe", locale: locale, value:author.join(' ')})
                }
                if (/\. (\d{4}-\d{4}|\d{4})/.test(objectPath.get(one, 'title.ru')))
                  existsOne.properties.push({key:"58b7f25feb62621713728df4",locale: locale, value:objectPath.get(one, 'title.'+locale).match(/\. (\d{4}-\d{4}|\d{4})/)[1]})
              }
            } else if (key === 'description') {
              title = existsOne.get('title.'+locale) || "";
              author = existsOne.get('author.'+locale) || "";
              text = objectPath.get(one, 'description.'+locale) || "";
              image = existsOne.topImage ? existsOne.topImage.attachment.preview.path : "";
              description = `<div class=\"block_wrapper\" data-id=\"1\"><div class=\"block_id_val\">#1</div> <div class=\"start_block\"> <div class=\"image\"> <div class=\"selector start_bg\" data-multi=\"false\"><img src=\"/attachments/${image}\" alt=\"\"></div></div><div class=\"start_text\"> <div class=\"editable_block start_small Medium Medium-rich\" data-placeholder=\"${author}\" contenteditable=\"true\">${author}</div><div class=\"editable_block start_big Medium Medium-rich\" data-placeholder=\"${title}\" contenteditable=\"true\">${title}</div></div></div></div><div class=\"block_wrapper\" data-id=\"2\"><div class=\"block_id_val\">#2</div> <div class=\"text_block\"> <div class=\"text\"> <div class=\"editable_block with_editor_panel Medium Medium-rich\" contenteditable=\"true\">${text}</div></div></div></div>`;
              existsOne.set('description.'+locale, description)
            } else {
              if (objectPath.has(one, key+"."+locale)) existsOne.set(one[key+"."+locale], objectPath.get(one, key+"."+locale));
              else existsOne.set(one[key+"."+locale], "")
            }
          }
        });
        callback(null, existsOne);
      }
    );

  };

// console.log(JSON.stringify(aSchema.paths, null, 2) );
var Subject = mongoose.model('Subject', aSchema);

module.exports = Subject;
