'use strict';


var _ = require('underscore');
var path =require("path");


// All configurations will extend these options
// ============================================
var all = {
  DCX: {
    host: "https://dc-x2.mkrf.ru",
    urlPrefix: "/dcx_mkrf/atom",
    user: "HERE IS DCX USER",
    password: "HERE IS DCX USER PASSWOD",

    pubInfoId: "publication_culture.rf", //"publication-architecturemuseum",
    uploadPathSuffix:"mkrf_uploadconfig_exibit_ar",
    cookieStorageFileName:__dirname,
    storyStatus: "taskstatus-closed", // 'taskstatus-closed'
    docBase: {
      'head': {
        'StateContractContractor': 'ООО "Датастек"',
        'StateContractDate': '2016-09-30T00:00:00+03:00',
        'StateContractNo': '4695-01-41/01-16',
        "Rights_Owns": {"topic": "rights_owns-3-2"},
        'Rights_Uses': {"topic": "rights_uses-other"},
        'Rights_Note': "Только в рамках проекта Artefact",
        'Creator': "Робот Экспонатов AR"
      }
    },
    classToDocMap: { 
      "Subject": {
        pool_id: [{ "$":{id:"exhibit_ar_story"} }],
        head:  {
          Status:   [{"$":{'topic': 'docstatus-draft'}}],
          Type:     [{"$":{'topic': 'documenttype-story'}}],
          StoryType: [{"$":{'topic': 'storytype-exibit_ar_object'}}],
          CategoryInformation: [{"$":{topic:'ci_digitalimage'} }], 
          ObjectType: [{"$":{topic:"objecttype_exhibit"} }]
        },
        $links:{
          topImage:"primarypicture",
          gallery :"galery"
        }
      },

      "Image": {
        // pool_id: { "$":{id:"exhibit_ar_story"} }
        head:  {
          // StoryType: {"$":{'topic': 'storytype-architecture_architect'}},
          Type:     [{"$":{'topic':"documenttype-image" } }],
          CategoryInformation: [{"$":{topic:'ci_digitalimage'} }], 
          ObjectType: [{"$":{topic:"objecttype_photo"} }]
        }
      }
    }  

  },
  // MongoDB connection options
  mongo: {
    uri: 'mongodb://localhost/dcx-exapmles',
    options: {
      db: {
        safe: true
      }
    }
  }
};
 

// Export the config object based on the NODE_ENV
module.exports = all
