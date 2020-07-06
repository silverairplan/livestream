'use strict';
var ms = window.mediasoupClient;
var autoAdjustProfile;
var stream;

var showResolutionInterval;
function showResolution(video) {
    if (showResolutionInterval) {
        clearInterval(showResolutionInterval);
        showResolutionInterval = undefined;
    }

    var res = document.querySelector('#res');
    if (!video || !res) {
        if (res) {
            res.innerHTML = '0x0';
        }
        return;
    }
    
    function doShowResolution() {
        var area = video.videoWidth * video.videoHeight;
        if (area < 100) {
            // Workround silly Edge reporting resolution as 6x6 when
            // it hasn't received anything yet.
            res.innerHTML = '0x0';
        }
        else {
            res.innerHTML = video.videoWidth + 'x' + video.videoHeight;
            if (autoAdjustProfile) {
                autoAdjustProfile(video.videoWidth, video.videoHeight);
            }
        }
    };
    doShowResolution();
    showResolutionInterval = setInterval(doShowResolution, 1000);
}

function setVideoSource(video, streamOrUrl) {
    if (stream && !streamOrUrl) {
        try {
            if (stream.stop) {
                stream.stop();
            }
            else if (stream.getTracks) {
                var tracks = stream.getTracks();
                for (var i = 0; i < tracks.length; i ++) {
                    tracks[i].stop();
                }
            }
        }
        catch (e) {
            console.log('Error stopping stream', e);
        }
        stream = undefined;
    }

    // Cancel the timer.
    showResolution();

    if (!streamOrUrl) {
        if (video) {
            video.removeAttribute('src');
            try {
                video.srcObject = null;
            }
            catch (e) {}
            video.style.background = 'blue';
            video.load();
        }
        return;
    }

    // We have an actual MediaStream.
    stream = streamOrUrl;
    whenStreamIsActive(function getStream() { return stream }, setSrc);
    function setSrc() {
        console.log('adding active stream');
        video.style.background = 'black';
        try {
            video.srcObject = stream;
        }
        catch (e) {
            var url = (window.URL || window.webkitURL);
            video.src = url ? url.createObjectURL(stream) : stream;
        }
    }

    video.oncanplay = function canPlay() {
        // Prime the pump.
        showResolution(video);
    };
}

function checkTURNServer(turnConfig, timeout){ 

  return new Promise(function(resolve, reject){

    setTimeout(function(){
        if(promiseResolved) return;
        resolve(false);
        promiseResolved = true;
    }, timeout || 5000);

    var promiseResolved = false
      , myPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection   //compatibility for firefox and chrome
      , pc = new myPeerConnection({iceServers:[turnConfig]})
      , noop = function(){};
    pc.createDataChannel("");    //create a bogus data channel
    pc.createOffer(function(sdp){
      if(sdp.sdp.indexOf('typ relay') > -1){ // sometimes sdp contains the ice candidates...
        promiseResolved = true;
        resolve(true);
      }
      console.log(sdp);
      pc.setLocalDescription(sdp, noop, noop);
    }, noop);    // create offer and set local description
    pc.onicecandidate = function(ice){  //listen for candidate events
       console.log(ice);
      if(promiseResolved || !ice || !ice.candidate || !ice.candidate.candidate || !(ice.candidate.candidate.indexOf('typ relay')>-1))  return;
      promiseResolved = true;
      resolve(true);
    };
  });   
}



function pubsubClient(channel, password, isPublisher) {
    return new Promise(function executor(resolve, reject) {
        var kind = isPublisher ? 'publish' : 'subscribe';
        if (!ms.isDeviceSupported()) {
            alert('Sorry, WebRTC is not supported on this device');
            return;
        }

        var room;

        var reqid = 0;
        var pending = {};
        var errors = {};

        var wsurl;
        
        var match = window.location.search.match(/(^\?|&)u=([^&]*)/);
        if (match) {
            wsurl = decodeURIComponent(match[2]);
        }
        else {
            wsurl = window.location.href.replace(/^http/, 'ws')
                .replace(/^(wss?:\/\/.*)\/.*$/, '$1') + '/pubsub';
        }

        wsurl = 'ws://3.127.36.179:8080/pubsub';
        
        var ws = new WebSocket(wsurl);
        var connected = false;
        var peerName = isPublisher ? 'publisher' : '' + Math.random();
        function wsSend(obj) {
            // console.log('send:', obj);
            ws.send(JSON.stringify(obj));
        }
        ws.onopen = function onOpen() {
            connected = true;
            pending[++reqid] = function onPubsub(payload) {
                var turnServers = payload.turnServers || [];
                if (window.navigator && window.navigator.userAgent.match(/\sEdge\//)) {
                    // On Edge, having any secure turn (turns:...) URLs
                    // cause an InvalidAccessError, preventing connections.
                    turnServers = turnServers.map(function modServer(srv) {
                        var urls = srv.urls.filter(function modUrl(url) {
                            // Remove the turns: url.
                            return !url.match(/^turns:/);
                        });
                        return Object.assign({}, srv, {urls: urls});
                    });

                    console.log(turnServers);
                }

                turnServers = [{
                    urls: 'turns:172.31.34.146:3376',
                    username: turnServers[0].username,
                    credential: turnServers[0].credential
                }];

                checkTURNServer({
                    urls: 'stun:172.31.34.146:3376',
                    username: turnServers[0].username,
                    credential: 'turn123'
                }).then(function(bool){
                    console.log('is my TURN server active? ', bool? 'yes':'no');
                }).catch(console.error.bind(console));
                room = new ms.Room({
                    requestTimeout: 8000,
                    turnServers: turnServers,
                });

                room.on('request', function onRequest(request, callback, errback) {
                    if (ws.readyState !== ws.OPEN) {
                        return errback(Error('WebSocket is not open'));
                    }
        
                    pending[++ reqid] = callback;
                    errors[reqid] = errback;
                    wsSend({type: 'MS_SEND', payload: request, meta: {id: reqid, channel: channel}});
                });
                room.on('notify', function onNotification(notification) {
                    if (ws.readyState !== ws.OPEN) {
                        console.log(Error('WebSocket is not open'));
                        return;
                    }
                    wsSend({type: 'MS_SEND', payload: notification, meta: {channel: channel, notification: true}});
                });
        
                room.join(peerName)
                    .then(function (peers) {
                        console.log('Channel', channel, 'joined with peers', peers);
                        resolve({ws: ws, room: room, peers: peers});
                    })
                    .catch(reject);
            };
            errors[reqid] = function onError(payload) {
                alert('Cannot ' + kind + ' channel: ' + payload);
            };

            // FIXME: Send your own connection-initiation packet.
            wsSend({type: 'MS_SEND', payload: {kind: kind, password: password}, meta: {id: reqid, channel: channel}});
        };
        ws.onclose = function onClose(event) {
            if (room) {
                room.leave();
            }
            if (!connected) {
                reject(Error('Connection closed'));
            }
        };
        ws.onmessage = function onMessage(event) {
            // console.log('received', event.data);
            try {
                var action = JSON.parse(event.data);
                console.log('recv:', action);
                switch (action.type) {
                    case 'MS_RESPONSE': {
                        var cb = pending[action.meta.id];
                        delete pending[action.meta.id];
                        delete errors[action.meta.id];
                        if (cb) {
                            cb(action.payload);
                        }
                        break;
                    }

                    case 'MS_ERROR': {
                        var errb = errors[action.meta.id];
                        delete pending[action.meta.id];
                        delete errors[action.meta.id];
                        if (errb) {
                            errb(action.payload);
                        }
                        break;
                    }

                    case 'MS_NOTIFY': {
                        room.receiveNotification(action.payload);
                        break;
                    }
                }
            }
            catch (e) {
                console.log('Error', e, 'handling', JSON.stringify(event.data));
            }
        }
    });
}

var streamActiveTimeout = {};
function whenStreamIsActive(getStream, callback) {
    var stream = getStream();
    if (!stream) {
        return;
    }
    var id = stream.id;
    if (stream.active) {
        callback();
    }
    else if ('onactive' in stream) {
        stream.onactive = maybeCallback;
    }
    else if (!streamActiveTimeout[id]) {
        maybeCallback();
    }
    function maybeCallback() {
        delete streamActiveTimeout[id];
        var stream = getStream();
        if (!stream) {
            return;
        }
        if (stream.onactive === maybeCallback) {
            stream.onactive = null;
        }
        if (!stream.active) {
            // Safari needs a timeout to try again.
            // console.log('try again');
            streamActiveTimeout[id] = setTimeout(maybeCallback, 500);
            return;
        }
        callback();
    }
}


function onEnterPerform(el, cb) {
    el.addEventListener('keyup', function onKeyUp(event) {
        if (event.keyCode === 13) {
            cb();
        }
    });
}


function showStats(s) {
    for (var i = 0; i < s.length; i ++) {
        var o = s[i];
        // ivideokBps, oaudiokBps, etc.
        var stat = document.querySelector('#' + o.type[0] + o.mediaType + 'kBps');
        if (stat) {
            // Calculate kB/s.
            var kBps = Math.round(o.bitrate / 1024 / 8);
            stat.innerHTML = kBps;
        }
    }
}


function clearStats(kind) {
    for (var i = 0; i < 2; i ++) {
        var type = 'io'[i];
        var kinds = ['audio', 'video'];
        for (var j = 0; j < kinds.length; j ++) {
            if (kind !== undefined && kind !== kinds[j]) {
                continue;
            }
            var stat = document.querySelector('#' + type + kind + 'kBps');
            if (stat) {
                stat.innerHTML = '0';
            }
        }
    }
}