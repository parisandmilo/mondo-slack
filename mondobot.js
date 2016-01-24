
require('dotenv').config();

/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('botkit'),
  redisConfig = {"url": process.env.REDIS_URL},
  redisStorage = require('botkit/lib/storage/redis_storage')(redisConfig);

if(process.env.local_redis){
  // is this a hack? maybe
  redisStorage = require('botkit/lib/storage/redis_storage')();
}
  
var mondo = require('mondo-bank');

var Witbot = require("witbot")
if (!process.env.slack_clientId || !process.env.slack_clientSecret || !process.env.botkit_port) {
  console.log('Error: Specify slack_clientId slack_clientSecret and botkit_port in environment');
  process.exit(1);
}
if (!process.env.mondo_token) {
    console.log('Error: Specify mondo_token in environment');
    process.exit(1);
}

if (!process.env.wit_token) {
    console.log('Error: Specify wit_token in environment');
    process.exit(1);
}

var mondoToken = process.env.mondo_token;
var witbot = Witbot(process.env.wit_token);
var helpers = require('./lib/helpers.js');

var controller = Botkit.slackbot({
  storage: redisStorage

}).configureSlackApp(
  {
    clientId: process.env.slack_clientId,
    clientSecret: process.env.slack_clientSecret,
    scopes: ['bot'],
  }
);

controller.setupWebserver((process.env.PORT || process.env.botkit_port),function(err,webserver) {
  webserver.get('/mondo-oauth/:user', function(req,res){
    console.log(req.params.user);
    res.send("mondo oauth");
  });
  controller.createWebhookEndpoints(controller.webserver);

  controller.createOauthEndpoints(controller.webserver,function(err,req,res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('Success!');
    }
  });
});


// just a simple way to make sure we don't
// connect to the RTM twice for the same team
var _bots = {};
function trackBot(bot) {
  _bots[bot.config.token] = bot;
}

controller.on('create_bot',function(bot,config) {

  if (_bots[bot.config.token]) {
    // already online! do nothing.
  } else {
    bot.startRTM(function(err) {

      if (!err) {
        trackBot(bot);
      }

      bot.startPrivateConversation({user: config.createdBy},function(err,convo) {
        if (err) {
          console.log(err);
        } else {
          convo.say('I am a bot that has just joined your team');
          convo.say('You must now /invite me to a channel so that I can be of use!');
        }
      });

    });
  }

});


// Handle events related to the websocket connection to Slack
controller.on('rtm_open',function(bot) {
  console.log('** The RTM api just connected!');
});

controller.on('rtm_close',function(bot) {
  console.log('** The RTM api just closed');
  // you may want to attempt to re-open
});

controller.hears('hello','direct_message',function(bot,message) {
  bot.reply(message,'Hello!');
  controller.storage.users.get(message.user, function(err, user){
    if(user.mondoToken){
      // mondo.accounts(user.)
    }
    else{
      bot.reply(message, "Hi there click here to access mondo: http://mondo.co.uk/oauth?callback_url=localhost:3000/mondo-oauth" + message.user);
    }
  });
});

controller.hears('^stop','direct_message',function(bot,message) {
  bot.reply(message,'Goodbye');
  bot.rtm.close();
});

controller.hears(['call me (.*)'],'direct_message,direct_mention,mention',function(bot, message) {
    var matches = message.text.match(/call me (.*)/i);
    var name = matches[1];
    controller.storage.users.get(message.user,function(err, user) {
        if (!user) {
            user = {
                id: message.user,
            };
        }
        user.name = name;
        controller.storage.users.save(user,function(err, id) {
            bot.reply(message,'Got it. I will call you ' + user.name + ' from now on.');
        });
    });
});

controller.hears(['what is my name','who am i'],'direct_message,direct_mention,mention',function(bot, message) {

    controller.storage.users.get(message.user,function(err, user) {
        if (user && user.name) {
            bot.reply(message,'Your name is ' + user.name);
        } else {
            bot.reply(message,'I don\'t know yet!');
        }
    });
});

controller.hears('.*', 'direct_message, direct_mention', function (bot, message) {
  //Add "working on it" reaction
    bot.api.reactions.add({timestamp: message.ts, channel: message.channel, name: 'thinking_face'},function(err,res) {
      if (err) {
        bot.botkit.log("Failed to add emoji reaction :(",err);
      }
    });

  var wit = witbot.process(message.text, bot, message);
  wit.hears("transaction", 0.5, require('./lib/replies/transaction.js'));
  wit.hears("account", 0.5, require('./lib/replies/account.js'))
  wit.hears("balance", 0.5, require('./lib/replies/balance.js'));

  wit.otherwise(require('./lib/replies/giph.js'));
})

controller.storage.teams.all(function(err,teams) {

  if (err) {
    throw new Error(err);
  }

  // connect all teams with bots up to slack!
  for (var t  in teams) {
    console.log("Team ", t);
    if (teams[t].bot) {
      var bot = controller.spawn(teams[t]).startRTM(function(err) {
        if (err) {
          console.log('Error connecting bot to Slack:',err);
        } else {
          trackBot(bot);
        }
      });
    }
  }

});