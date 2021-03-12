'use strict';

const https = require('https');
const AWS = require('aws-sdk'); // eslint-disable-line import/no-extraneous-dependencies
const uuid = require('uuid');

const s3 = new AWS.S3();

const Polly = new AWS.Polly({
  signatureVersion: 'v4',
  region: 'us-east-1'
})

const Sns = new AWS.SNS({ apiVersion: '2010-03-31' });

const Twilio = require('twilio');
const client = new Twilio(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET);

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
        if(firstResult){
          resolve(firstResult.pageid);
        } else {
          resolve(null);
        }
        
      });

    }).on("error", (err) => {
      reject(err.message);
    });
  });
}

const wikiExtract = (pageId) => {
  return new Promise((resolve, reject) => {
    if(pageId){
      https.get('https://pt.wikipedia.org/w/api.php?format=json&action=query&prop=extracts&exintro&explaintext&exsentences=3&redirects=1&pageids=' + pageId, (resp) => {
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
    } else {
      resolve('Não foi possivel encontrar um resultado para a sua pesquisa. Tente novamente.');
    }
  });
}

const createAudio = (text) => {
  let params = {
    'Text': text,
    'Engine': 'neural',
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

  return s3.upload(params).promise();
}


module.exports.writeMessageToS3 = async (event, context) => {
  try {

    var putObjectPromises = event.Records.map(async function (obj, index) {
      return new Promise((resolve, reject) => {
        var bodyObject = JSON.parse(obj.body);
        var queryString = bodyObject.q;
        var toNumber = bodyObject.to;
        var from = bodyObject.from;

        wikiSearch(queryString).then(results => {
          wikiExtract(results).then(extract => {
            createAudio(extract).then(audio => {
              saveObjectOnS3(audio.AudioStream).then(file => {
                sendMediaMessage(file.Location, from, toNumber);
              })
            });
          })
        })
      });
    });

    await Promise.all(putObjectPromises);

  } catch (error) {
    context.captureError(error);
  }
}

module.exports.sendMessageToSNS = async (event, context) => {
  try {
    if (event.pathParameters.apiKey != process.env.SELF_API_KEY) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            message: 'Unauthorized',
            input: event,
          },
          null,
          2
        ),
      };
    }

    let params = new URLSearchParams(event.body);
    return publishToSNS(JSON.stringify({ "q": params.get('Body'), "to": params.get('WaId'), "from": params.get('To') })).then(response => {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            message: 'Success',
            input: event,
          },
          null,
          2
        ),
      };
    })
  } catch (error) {
    context.captureError(error);
  }
}