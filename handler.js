'use strict';

const https = require('https');
const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const uuid = require('uuid');

const s3 = new AWS.S3();

const Polly = new AWS.Polly({
  signatureVersion: 'v4',
  region: 'us-east-1'
})

const Sns = new AWS.SNS({apiVersion: '2010-03-31'});

const Twilio = require('twilio');
const client = new Twilio('AC66ff487f0f2d064ea0be8c996e7f46ab', 'b35175f3d34901afdb419ab724a0851d');

const sendMediaMessage = (mediaUrl, from, toNumber) => {
  return client.messages
    .create({
      from: from,
      to: `whatsapp:+${toNumber}`,
      mediaUrl: [mediaUrl]
    });
};

const sendMessage = (text, from, toNumber) => {
  return client.messages
    .create({
      from: from,
      to: `whatsapp:+${toNumber}`,
      body: text
    });
};

const publishToSNS = (body) => {

  console.log(`body: `, body);
  let params = {
    Message: body, /* required */
    TopicArn: process.env.topicARN
  };

  return Sns.publish(params).promise();
} 


const wikiSearch = (text) => {
  return new Promise((resolve, reject) => {
    https.get('https://pt.wikipedia.org/w/api.php?action=query&format=json&prop=&list=search&srsearch=' + text, (resp) => {
      let data = '';

      resp.on('data', (chunk) => {
        data += chunk;
      });
    
      resp.on('end', () => {
        let firstResult = JSON.parse(data).query.search.find(e => true);
        resolve(firstResult.pageid);
      });
    
    }).on("error", (err) => {
      reject(err.message);
    });  
  });
}

const wikiExtract = (pageId) => {
  return new Promise((resolve, reject) => {
    https.get('https://pt.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro&explaintext&redirects=1&pageids=' + pageId, (resp) => {
      let data = '';

      resp.on('data', (chunk) => {
        data += chunk;
      });
    
      resp.on('end', () => {
        let pagesObj = JSON.parse(data).query.pages;
        let pagesKey = Object.keys(pagesObj);
        let firstResult = pagesObj[pagesKey[0]];
        resolve(firstResult.extract);
      });
    
    }).on("error", (err) => {
      reject(err.message);
    });  
  });
}

const createAudio = (text) => {
  let params = {
    'Text': text,
    'Engine' : 'neural',
    'OutputFormat': 'mp3',
    'VoiceId': 'Camila'
  }
  return Polly.synthesizeSpeech(params).promise();
}


const saveObjectOnS3 = (object) => {
  let params = {
    Key: uuid.v4() + '.mp3',
    Bucket: `wlad-sls-bucket-${process.env.STAGE}`,
    ContentType: "audio/mpeg",
    ACL: 'public-read',
    Body: object
  }
  console.log(params);

  return s3.upload(params).promise();
}


module.exports.writeMessageToS3 = async (event, context) => {
  try{
    var putObjectPromises = event.Records.map(async function (obj, index) {
      return new Promise((resolve, reject) => {
        console.log('object: ', obj);
        
        var bodyObject = JSON.parse(obj.body);
        var queryString = bodyObject.q;
        var toNumber = bodyObject.to;
        var from = bodyObject.from;

        wikiSearch(queryString).then(results => {
          wikiExtract(results).then(extract => {
            createAudio(extract).then( audio => {
              saveObjectOnS3(audio.AudioStream).then( file => {
                sendMediaMessage(file.Location, from, toNumber);
              })
            });
          })
        })
      });
    });
    
    await Promise.all(putObjectPromises).then((values => {
      console.log(values);
    }));


    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Go Serverless v1.0! Your function executed successfully!',
          input: event,
        },
        null,
        2
      ),
    };
  } catch(error){
    context.captureError(error);
    sendMessage(error.errorMessage);
  }
}

module.exports.sendMessageToSNS = async (event, context) => {
  try {
    let params = new URLSearchParams(event.body);
    console.log(`Event: `, event);
    console.log(`params `, params);
    console.log(`params.get('Body'): `, params.get('Body'));
    return publishToSNS(JSON.stringify({"q" : params.get('Body'), "to" : params.get('WaId'), "from" : params.get('To')})).then(response => {
      return {
        statusCode: 200,
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(
          {
            message: 'Go Serverless v1.0! Your function executed successfully!',
            input: event,
          },
          null,
          2
        ),
      };
    })
  } catch(error){
    context.captureError(error);
    sendMessage(error.errorMessage);
  }
}