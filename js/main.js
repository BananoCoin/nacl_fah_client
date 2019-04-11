/*
              This file is part of the Folding@home NaCl Client

        Copyright (c) 2013-2014, Hong Kong University Science & Technology
               Copyright (c) 2013-2018, Stanford University
                          Copyright (c) 2019 BANANO               
                             All rights reserved.

        This software is free software: you can redistribute it and/or
        modify it under the terms of the GNU Lesser General Public License
        as published by the Free Software Foundation, either version 2.1 of
        the License, or (at your option) any later version.

        This software is distributed in the hope that it will be useful,
        but WITHOUT ANY WARRANTY; without even the implied warranty of
        MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
        Lesser General Public License for more details.

        You should have received a copy of the GNU Lesser General Public
        License along with this software.  If not, see
        <http://www.gnu.org/licenses/>.

                For information regarding this software email:
                               Joseph Coffland
                        joseph@cauldrondevelopment.com
*/

var fah = {
  version: '8.2.0',
  user: null,
  team: 234980,

  intercom_id: 'fah-nacl-client',
  timestamp: new Date().getTime(),

  as_urls: ['//assign1.foldingathome.org', '//assign2.foldingathome.org'],
  stats_url: '//apps.foldingathome.org/stats.py',
  project_url: '//apps.foldingathome.org/project-jsonp.py',

  current_as: 0,

  max_project_brief: 1000, // Maximum brief project description length
  min_delay: 15,
  max_delay: 15 * 60,

  pausing: false,
  paused: false,
  finish: false,
  use_pnacl: false,

  last_stats: 0,
  last_progress_time: 0,
  last_progress_count: 0,
  eta: [],

  projects: {},
  dialog_widths: {},

  wu_results_max_errors: 3,
  wu_results_errors: 0,

  message_id: 0,

  last: null
};


// Utility functions ***********************************************************
function debug() {
  if (typeof console == 'undefined' || typeof console.log == 'undefined')
    return;

  var msg = $.map(arguments, function (item) {
    if (typeof item !== 'string' && typeof JSON !== 'undefined')
      return JSON.stringify(item);
    return item;
  });

  console.log('DEBUG: ' + msg.join(' '));
}


function int(x) {
  return Math.floor(x);
}


var MIN = 60;
var HOUR = 60 * MIN;
var DAY = 24 * HOUR;
var YEAR = 365 * DAY;

function human_time_slice(t, d1, n1, d2, n2) {
  var x = int(t / d1);
  var y = int((t % d1) / d2);

  return x + ' ' + n1 + (1 < x ? 's' : '') + ' and ' +
    y + ' ' + n2 + (1 < y ? 's' : '');
}


function human_time(t) {
  if (YEAR <= t) return human_time_slice(t, YEAR, 'year', DAY, 'day');
  if (DAY <= t) return human_time_slice(t, DAY, 'day', HOUR, 'hour');
  if (HOUR <= t) return human_time_slice(t, HOUR, 'hour', MIN, 'minute');
  if (MIN <= t) return human_time_slice(t, MIN, 'minute', 1, 'second');
  return t + ' second' + (1 < t ? 's' : '');
}


function friendly_time(t) {
  if (HOUR <= t) return 'about ' + human_time(t);

  if (MIN <= t) {
    var x = int(t / MIN);
    return 'about ' + x + ' minute' + (1 < x ? 's' : '');
  }

  return 15 < t ? 'less than a minute' : 'a few seconds';
}


function human_number(x) {
  var parts = x.toString().split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}


function ab2str(buf) {
  var s = "";
  var bufView = new Uint8Array(buf);

  for (var i = 0; i < bufView.length; i++)
    s += String.fromCharCode(bufView[i]);

  return s;
}


function str2ab(str) {
  var buf = new ArrayBuffer(str.length);
  var bufView = new Uint8Array(buf);

  for (var i = 0; i < str.length; i++)
    bufView[i] = str.charCodeAt(i);

  return buf;
}


function get_query(name) {
  name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
  var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
  var results = regex.exec(location.search);

  return results == null ? undefined :
    decodeURIComponent(results[1].replace(/\+/g, ' '));
}


// Messages ********************************************************************
function message_display(msg, timeout) {
  debug(msg);

  $('.message:contains("' + msg + '")').remove();

  var id = fah.message_id++;

  $('<div>')
    .addClass('message message-' + id)
    .html(msg)
    .prepend($('<div>')
             .addClass('message-close')
             .on('click', function () {
               $('.message-' + id).remove();
             }))
    .prependTo('body');

  if (typeof timeout != 'undefined' && timeout)
    setTimeout(function () {
      $('.message-' + id).remove();
    }, timeout * 1000);
}


function message_warn(msg, timeout) {
  if (typeof timeout == 'undefined') timeout = 30;
  message_display('Warning: ' + msg, timeout);
}


// Intercom ********************************************************************
function intercom_init() {
  var intercom = Intercom.getInstance();

  intercom.on(fah.intercom_id, function(data) {
    if (data.ts == fah.timestamp) return;

    switch (data.cmd) {
    case 'pause':
      if (!fah.pausing) {
        message_warn('Another instance was started, pausing');
        pause_folding(false);
      }
      break;

    case 'hello':
      if (!fah.pausing) intercom_emit('pause');
      break;
    }
  });
}


function intercom_emit(cmd) {
  var intercom = Intercom.getInstance();
  intercom.emit(fah.intercom_id, {ts: fah.timestamp, cmd: cmd});
}


// Dialogs *********************************************************************
function dialog_open(name, closable, buttons) {
  if (typeof closable == 'undefined') closable = true;

  var div = $('#' + name + '-dialog');
  var width = fah.dialog_widths[name];
  if (typeof width == 'undefined') width = div.css('width');
  if (typeof width == 'undefined' || width == '0px') width = '500px';
  fah.dialog_widths[name] = width;

  if (closable) {
    if (typeof buttons == 'undefined') buttons = [];
    buttons = buttons.concat([
      {text: 'Ok', click: function () {$(this).dialog('close');}}]);
  }

  div.dialog({
    modal: true, closeOnEscape: closable, width: width,
    buttons: buttons,
    open: function(event, ui) {
      if (!closable)
        $('.ui-dialog-titlebar-close', $(this).parent()).hide();
    }});
}


function dialog_open_event(e) {
  dialog_open($(this).attr('name'));
  e.preventDefault();
}


function dialog_open_fatal(name) {
  buttons = [
    {text: 'Reload', click: function () {
      window.location = window.location;
    }}];
  dialog_open(name, false, buttons);
  delete fah.wu;
}


// Watchdog ********************************************************************
function watchdog_timeout() {
  if (fah.pausing) watchdog_kick();
  else fah.watchdog_call();
}


function watchdog_set(t, call) {
  fah.watchdog_call = call;
  fah.watchdog_time = t;
  clearTimeout(fah.watchdog);
  fah.watchdog = setTimeout(watchdog_timeout, t);
}


function watchdog_kick() {
  clearTimeout(fah.watchdog);
  watchdog_set(fah.watchdog_time, fah.watchdog_call);
}


function watchdog_clear() {
  clearTimeout(fah.watchdog);
}


// NaCl ************************************************************************
function module_insert() {
  var nmf;
  var type;

  if (fah.use_pnacl) {
    var ver = 35;
    if (36 < fah.chrome_version) ver = 37;
    else if (35 < fah.chrome_version) ver = 36;

    nmf = 'fahcore_b0-c' + ver + '-pnacl.nmf'
    type = 'application/x-pnacl';

  } else {
    nmf = 'fahcore_b0.nmf';
    type = 'application/x-nacl';
  }

  debug('Inserting module ' + nmf + ' with type ' + type);

  $('#fahcore')
    .html($('<embed>').attr({src: nmf, type: type}));

  fah.module = $('#fahcore embed').get(0);
  var x = fah.module.offsetTop; // Chrome Hack

  if (typeof fah.module.readyState == 'undefined') module_error();
}


function module_loading() {
  watchdog_kick();

  debug('Module loading');
  status_set('downloading', 'Downloading the Folding@home software in your ' +
             'Web browser.  On your first visit this can take a while.');
  return false;
}


function module_progress(event) {
  watchdog_kick();

  var default_total = 18000000;
  var total = event.total ? event.total : default_total;
  if (default_total * 100 < total ) total = default_total // Sanity check

  var percent = (event.loaded / total * 100.0).toFixed(1);
  var msg = percent + '%';

  if (0 < percent) watchdog_clear();

  fah.progress_total = total;
  progress_update(event.loaded);

  debug('load progress: ' + msg + ' (' + event.loaded + ' of ' + total +
        ' bytes)');
  return false;
}


function module_load_failed() {
  dialog_open_fatal('load-failed');
}


function module_loaded() {
  watchdog_set(30000, module_load_failed);

  debug("NaCl module loaded");
  fah.nacl = $('#fahcore embed').get(0);
  post_message('ping');
  return false;
}


function module_exit() {
  debug('Module exit');
  module_insert();
  return false;
}


function module_timeout() {
  if (!fah.use_pnacl) module_error();
  else {
    dialog_open_fatal('nacl-error');
    fah.pausing = fah.paused = true;
  }
}


function post_message(msg) {
  if (typeof fah.nacl != 'undefined') fah.nacl.postMessage(msg);
}


function module_message(event) {
  var cmd = (typeof event.data == 'string') ? event.data : event.data[0];

  switch (true) {
  case cmd == 'pong':
    debug("NaCl module responded");
    watchdog_clear();
    init(); // Start client
    break;

  case cmd == 'threads': fah.threads = event.data[1]; break;
  case cmd == 'step': step_wu(event.data[1], event.data[2]); break;
  case cmd == 'results':
    finish_wu(event.data[1], event.data[2], event.data[3]);
    break;
  case cmd == 'paused': folding_paused(); break;
  case cmd == 'unpaused': folding_unpaused(); break;
  default: debug(event.data); break;
  }

  return false;
}


function module_error(event) {
  if (fah.use_pnacl) message_warn('PNaCl module failure, fatal', 0);

  else {
    debug('NaCl module failure, trying PNaCl');
    fah.use_pnacl = true;
    watchdog_kick();
    module_insert();
  }

  return false;
}


// Config **********************************************************************
function config_key(name) {
  return 'fah_' + name;
}


function config_set(key, value, expires) {
  if (typeof(expires) == 'undefined') expires = 100 * 365;

  Cookies.set(config_key(key), value, {expires: expires});

  if (key == 'passkey') value = '********************************';
  debug('Config: ' + key + ' = ' + value);
}


function config_get(key, defaultValue) {
  if (typeof(defaultValue) != 'undefined' && !config_has(key))
    return defaultValue;

  return Cookies.get(config_key(key));
}


function config_has(key) {
  return typeof(config_get(key)) != 'undefined';
}


function config_del(key) {
  Cookies.remove(config_key(key));
  debug('Config: deleted ' + key);
}

// Projects ********************************************************************
function project_show(id) {
  if (id in fah.projects)
    $('#project .brief')
    .html(fah.projects[id].brief)
    .find('a').attr('target', '_blank');
}


function project_details(id) {
  $('#project-dialog')
    .attr('title', 'Project: ' + id)
    .html(fah.projects[id].details)
    .find('a').attr('target', '_blank');

  dialog_open('project');
}


function project_update(data) {
  if (data[0].length != 2 || data[0][0] != 'project') {
    debug("Unexpected project response:", data);
    return;
  }

  var p = data[0][1];

  var brief;
  var details;

  if (typeof p.error != 'undefined')
    brief = details = '<em>' + p.error + '</em>';

  else {
    // Shorten brief description if necessary
    var desc;
    if (fah.max_project_brief - 3 < p.pdesc.length)
      desc = p.pdesc.substr(0, fah.max_project_brief - 3) + '. . .';
    else desc = p.pdesc;

    // Thumb
    var thumb;
    if (typeof p.pthumb != 'undefined')
      thumb = $('<img>')
      .attr('src', 'data:;base64, ' + p.pthumb)
      .addClass('pthumb');

    // Brief
    brief = $('<div>').addClass('project');
    if (thumb) brief.append(thumb);
    $('<p>').html(desc)
      .append($('<a>')
              .attr({href: 'javascript:void()',
                     onclick: 'project_details(' + p.id +
                     '); return false;'})
              .text('Learn more'))
      .appendTo(brief);

    // Details
    details = $('<div>').addClass('project details');
    if (thumb) details.append(thumb.clone());
    $('<p>')
      .append($('<em>').text('Disease Type:'))
      .append(' ' + p.disease)
      .appendTo(details);
    $('<p>').html(p.pdesc).appendTo(details);
    details.append('<hr>');
    $('<em>').text('Managed by ' + p.name + ' at ' + p.uni + '.')
      .appendTo(details);
    if (p.url != '') $('<p>').append('URL: ')
      .append($('<a>').attr('href', p.url).text(p.url)).appendTo(details);
    if (p.mthumb != '')
      $('<div>').addClass('mthumb')
      .append($('<img>').attr('src', 'data:;base64, ' + p.mthumb))
      .appendTo(details);
    $('<p>').html(p.mdesc).appendTo(details);
  }

  fah.projects[p.id] = {brief: brief, details: details};

  if (p.id == fah.project) project_show(p.id);
}


function project_load(id) {
  if (!id) return;

  if (id in fah.projects) {
    project_show(id);
    return;
  }

  $('span.project').text(id);
  $('#project .brief').html(
    '<a href="#" onclick="project_load(' + id +
      ')">Loading details...</a>');

  $.ajax({
    url: fah.project_url,
    type: 'GET',
    data: {'id': id, 'version': fah.version},
    cache: true,
    dataType: 'jsonp',
    success: project_update
  });
}


// UI Status *******************************************************************
function eta_reset(clear) {
  if (typeof clear == 'undefined' || clear) fah.eta = 0;
  $('#eta').text('');
  fah.last_progress_time = 0;
  fah.last_progress_count = 0;
  fah.last_eta = 0;
}


function eta_update(count) {
  var eta = 0;
  var now = new Date().valueOf();
  var delta = count - fah.last_progress_count;

  if (0 < delta && fah.last_progress_time) {
    var sample = (now - fah.last_progress_time) / delta;
    fah.eta = fah.eta ? fah.eta * 0.98 + sample * 0.02 : sample;
  }
  if (0 < fah.eta) eta = (fah.progress_total - count) * fah.eta / 1000.0;

  // Smooth out rapid changes on edges
  if (fah.last_eta && fah.last_eta < eta) {
    var small = 1;
    if (YEAR <= fah.last_eta) small = DAY;
    else if (DAY <= fah.last_eta) small = HOUR;
    else if (HOUR <= fah.last_eta) small = MIN;
    else if (MIN <= fah.last_eta) small = MIN;

    if (eta - fah.last_eta <= 2 * small) eta = fah.last_eta;
  }
  fah.last_eta = eta;

  if (delta) fah.last_progress_time = now;
  fah.last_progress_count = count;

  return eta;
}


function ppd_update() {
  var ppd = 0;
  var wu_time = 0;
  var now = new Date().valueOf();
  var wu_points = 125; // TODO Read this from WU data

  // ETA (in sec) and now/wu_start (in ms)
  wu_time = ((now - fah.wu_start) / 1000.0) + fah.last_eta;

  // Number of WU per day = DAY / wu_time
  // PPD = number of WU per day * 125 points per WU
  ppd = int((DAY / wu_time) * wu_points);

  return ppd;
}


function power_init() {
  var slider = $('#slider');
  slider.slider({
    min: 1, max: 3, range: "min", value: 1,
    slide: function(event, ui) {
      var margin = {1: -2, 2: -12, 3: -24}[ui.value];
      slider.find(".ui-slider-handle").css({"margin-left": margin});
    },
    stop: function(e, ui) {power_set(ui.value);}
  });

  var power = config_get('power', 'medium');
  power_update(power);
  power_set(power);
}


function power_update(power) {
  power = power.toLowerCase();

  var v = {'light': 1, 'medium': 2, 'full': 3};
  $('#slider').slider('option', 'value', v[power]);

  var margin = {'light': -1, 'medium': -12, 'full': -24}[power];
  $('#slider').find(".ui-slider-handle").css({"margin-left": margin});
}


function power_set(power) {
  if (typeof power != 'string')
    power = {1: 'light', 2: 'medium', 3: 'full'}[power];

  config_set('power', power);
  try {post_message(['power', power]);} catch (e) {}
}


function progress_start(total) {
  fah.progress_total = total;
  $('#progress div').css({width: 0}).text('0.0%');
  eta_reset();
}


function progress_update(current) {
  if (fah.pausing) {
    $('#progress div')
      .css({width: '100%'})
      .addClass('paused')
      .text('Paused');
    eta_reset(false);
    return;
  }

  var percent = (current / fah.progress_total * 100).toFixed(1) + '%';
  if (percent != fah.last_progress_percent_text)
    $('#progress div')
    .css({width: percent})
    .removeClass('paused')
    .text(percent);
  fah.last_progress_percent_text = percent;

  var eta = Math.floor(eta_update(current));
  if (!eta || YEAR <= eta) eta = '';
  else eta = 'Completion expected in ' + friendly_time(eta) + '.';
  if (eta != fah.last_eta_text) $('#eta').text(eta);
  fah.last_eta_text = eta;

  // Supress last two digits for large PPDs to avoid bouncing numbers on screen.
  var ppd_show = ppd_update()
  var digit = int(Math.log(ppd_show) / Math.log(10))
  if (digit > 2) ppd_show = int(ppd_show / 100) * 100;

  ppd_text = 'Estimated Points Per Day (PPD): ' + human_number(ppd_show);
  if (ppd_text != fah.last_ppd_text) $('#ppd').text(human_number(ppd_text));
  fah.last_ppd_text = ppd_text
}


function status_unpause() {
  var status = fah.status;
  var msg = fah.msg;
  fah.status = fah.msg = '';
  status_set(status, msg);
}


function status_set(status, msg) {
  if (status != 'paused') {
    if (fah.status == status && fah.msg == msg) return;

    debug('Status: ' + status + ': ' + msg);
    fah.status = status;
    fah.msg = msg;
  }

  if (!fah.paused) {
    $('#status-image')
      .removeClass()
      .addClass(status)
      .attr('title', msg);
    $('#status-text').text(msg);
  }
}


// Backoff *********************************************************************
function backoff_reset(name) {
  if (typeof name == 'undefined') fah.backoff = {}
  else delete fah.backoff[name];
}


function backoff(call, id, msg) {
  var delay;

  if (typeof fah.backoff[id] == 'undefined') delay = fah.min_delay;
  else {
    delay = 2 * fah.backoff[id];
    if (fah.max_delay < delay) delay = fah.max_delay;
  }

  fah.backoff[id] = delay;

  status_set('waiting', msg);
  progress_start(delay);
  countdown(delay * 1000, call);
}


function countdown_paused(call) {
  if (fah.pausing) setTimeout(function () {countdown_paused(call)}, 250);
  else {
    folding_unpaused();
    call();
  }
}


function countdown(delay, call) {
  if (fah.pausing) {
    folding_paused();
    progress_update(0);
    countdown_paused(call);
    return;
  }

  progress_update(fah.progress_total - delay / 1000, delay / 1000);

  if (delay <= 0) {
    call();
    return;
  }

  var delta = Math.min(250, delay);
  setTimeout(function () {countdown(delay - delta, call);}, delta);
}


// Network functions ***********************************************************
function xhr_progress(xhr, cb) {
  if (typeof(cb) == 'undefined') return;

  xhr.upload.addEventListener("progress", function(evt) {
    if (evt.lengthComputable) cb(evt.loaded / evt.total);
  }, false);
}


function server_call(url, data, success, error, upload, download) {
  if (fah.pausing) {
    folding_paused();
    setTimeout(function () {server_call(url, data, success, error);}, 250);
    return;

  } else folding_unpaused();

  if (typeof data == 'undefined') data = {};
  data.version = fah.version;
  data.type = 'NACL';
  data.subtype = 'NACL_FULL';
  data.os = 'NACL';
  data.user = fah.user;
  data.team = fah.team;
  data.passkey = fah.passkey;

  url += '?' + Math.random();

  $.ajax({
    url: url,
    type: 'POST',
    data: JSON.stringify(data),
    dataType: 'json',
    contentType: 'application/json; charset=utf-8',

    xhr: function () {
      var xhr = new window.XMLHttpRequest();
      xhr_progress(xhr, upload);
      xhr_progress(xhr, download);
      return xhr;
    }
  }).done(success).fail(error);
}


function as_call(cmd, data, success, error) {
  server_call(fah.as_urls[fah.current_as] + '/api/' + cmd,
              data, success, error);
}


function ws_call(ws, cmd, data, success, error, upload, download) {
  server_call('//' + ws + '/api/' + cmd, data, success, error, upload,
              download);
}


function wu_return(server, success, error) {
  progress_start(1);
  ws_call(server, 'results',
          {wu: fah.wu, results: fah.results, signature: fah.signature,
           data: fah.data}, success, error, progress_update);
}


// State Transitions ***********************************************************
function init() {
  if (fah.finish) {
    pause_folding(false);
    progress_update(0);
  }

  backoff_reset();

  if (!config_has('id')) request_id();
  else request_assignment();
}


function next_as() {
  if (++fah.current_as == fah.as_urls.length) {
    fah.current_as = 0;
    return true;
  }

  return false;
}


function request_id() {
  status_set('downloading', 'Requesting ID.');
  as_call('id', {}, process_id, request_id_error);
}


function process_id(data) {
  if (typeof data == 'undefined' || data[0] != 'id') {
    message_warn('Unexpected response to ID request: ' + data);
    request_id_error();
    return;
  }

  config_set('id', data[1]);

  request_assignment();
}


function request_id_error(jqXHR, status, error) {
  if (typeof status != 'undefined') message_warn('ID request failed, retrying');
  if (!next_as()) backoff(request_id, 'id', 'Waiting to retry ID request');
}


function request_assignment() {
  status_set('downloading', 'Requesting a work server assignment.');
  delete fah.results;

  var data = {
    client_id: config_get('id'),
    threads: fah.threads
  }

  var projectKey = get_query('project-key');
  if (typeof projectKey != 'undefined')
    data.project_key = projectKey;

  as_call('assign', data, request_wu, as_assign_error);
}


function as_assign_error(jqXHR, status, error) {
  message_warn('Work Server assignment failed');
  assign_error(jqXHR, status, error);
}


function assign_error(jqXHR, status, error) {
  if (!next_as()) backoff(request_assignment, 'ws',
                          'Waiting to retry work server assignment');
}


function ws_assign_error(jqXHR, status, error) {
  message_warn('Work Unit assignment failed, retrying');
  assign_error(jqXHR, status, error);
}


function request_wu(data) {
  if (typeof data == 'undefined' || data[0] != 'assign' || data.length < 4) {
    message_warn('Unexpected response to AS assignment request: ' + data);
    assign_error();
    return;
  }

  // TODO Monitor download progress
  var assign = data[1];
  debug('WS:', assign);
  fah.ws = assign.ws;
  project_load(fah.project = assign.project);
  fah.as_cert = data[3];

  status_set('downloading', 'Downloading a work unit.');

  progress_start(1);
  ws_call(fah.ws, 'assign', {assignment: assign, signature: data[2],
                             as_cert: data[3]},
          start_wu, ws_assign_error, undefined, progress_update);
}


function start_wu(data) {
  if (typeof data == 'undefined' || data[0] != 'wu' || data.length != 6) {
    message_warn('Unexpected response to WU assignment request: ' + data);
    assign_error();
    return;
  }

  var wu = data[1];
  debug('WU:', wu);
  fah.wu = wu;
  fah.wu_signature = data[2];
  fah.finish = false;
  fah.wu_start = new Date().valueOf();

  status_set('running', 'Starting work unit.');
  progress_start(0);
  post_message(['start', JSON.stringify(wu), data[2], data[3], data[4],
                str2ab(data[5])]);
  post_message(['power', config_get('power')]);

  intercom_emit('pause'); // Tell other instances to pause
}


function step_wu(total, count) {
  status_set('running', (fah.finish) ?
             'Calculations underway; then finishing.' :
             'Calculations underway.');
  fah.progress_total = total;
  var eta = (total - count) / 10; // TODO
  progress_update(count, eta);
}


function finish_wu(results, signature, data) {
  var t = int((new Date().valueOf() - fah.wu_start) / 1000);
  debug('WU took ' + human_time(t));

  status_set('uploading', 'Uploading results.');
  fah.results = JSON.parse(results);
  fah.signature = signature;
  fah.data = data;
  fah.wu_results_errors = 0;
  return_ws();
  backoff_reset('ws');

}


function return_ws() {wu_return(fah.ws, return_ws_results, return_cs);}


function handle_ws_results(data, success, failure) {
  if (typeof data == 'undefined') return failure();
  if (data == 'success') return success();

  if (data.length == 2 && data[0] == 'error') {
    var status = data[1].split(' ')[0];
    message_warn('Work Server said ' + status);

    switch (status) {
    case 'WORK_ACK':
    case 'WORK_QUIT':
    case 'GOT_ALREADY':
    case 'PAST_DEADLINE':
      // Move on
      return success();

    case 'PLEASE_WAIT':
      // Recoverable
      return failure();

    case 'EMPTY_DATA':
    case 'SHORT_PAYLOAD':
      // Retry a few times
      if (++fah.wu_results_errors < fah.wu_results_max_errors)
        return failure();
      // Fall through

    case 'BAD_SIGNATURE':
    case 'TOKEN_INVALID':
    case 'BAD_VERSION':
    case 'BAD_CORE':
    default:
      // Fatal
      $('#ws-response').text(status);
      dialog_open_fatal('wu-results-error');
      break;
    }
  }
}

function return_ws_results(data) {
  handle_ws_results(data, wu_complete, return_cs);
}


function return_cs(jqXHR, status, error) {
  debug('WU return to WS failed:', error);

  if (fah.wu.cs) wu_return(fah.wu.cs, return_cs_results, return_cs_error);
  else wu_retry();
}


function return_cs_results(data) {
  handle_ws_results(data, wu_complete, return_cs_error);
}


function return_cs_error(jqXHR, status, error) {
  debug('WU return to CS failed:', error);
  wu_retry();
}


function wu_retry() {
  message_warn('Failed to return results, retrying');
  backoff(return_ws, 'return', 'Waiting to retry sending results');
}


function wu_complete() {
  delete fah.wu;
  module_insert();
}


function folding_unpaused() {
  fah.paused = false;
  status_unpause();
  intercom_emit('pause'); // Tell other instances to pause
}


function folding_paused() {
  if (fah.paused) return;

  if (fah.finish)
    status_set('finished', 'Folding finished, exit the browser or close ' +
               'this page to shutdown Folding@home or press the start ' +
               'button to resume folding.');
  else status_set('paused', 'Press the start button to continue.');

  eta_reset(false);

  fah.paused = true;
}


function pause_folding(save) {
  if (fah.pausing) return;
  fah.pausing = true;

  if (typeof save == 'undefined' || save) config_set('paused', true);

  $('.folding-stop').hide();
  $('.folding-start').show();

  post_message(['pause']);

  return false;  // Prevent default action
}


function unpause_folding() {
  if (!fah.pausing) return;
  fah.pausing = false;
  fah.finish = false;
  config_del('paused');

  $('.folding-start').hide();
  $('.folding-stop').show();

  post_message(['unpause']);

  return false; // Prevent default action
}


// Identity ********************************************************************
function load_identity() {
  // Handle URL user
  try {
    var url_user = get_query('user');
    if (url_user) {
      config_set('user', url_user);
    }
  } catch (e) {} // Ignore

  if (config_has('user')) {
    fah.user = config_get('user')
    $('#username').html(config_get('user'));
    config_set('user', config_get('user')); // Extend expiration
  }

  $('input.team').val(fah.team);

  if (config_has('passkey')) {
    $('input.passkey').val(fah.passkey = config_get('passkey'));
    config_set('passkey', config_get('passkey')); // Extend expiration
  }
}

(function ($) {
  $.fn.dialogNoClose = function () {
     return this.each(function () {
        // hide the close button and prevent ESC key from closing
        $(this).closest(".ui-dialog").find(".ui-dialog-titlebar-close").hide();
        $(this).dialog("option", "closeOnEscape", false);
     });
  };
})(jQuery)

// Init ************************************************************************
$(function () {
  // Make sure there is only one instance running
  intercom_init();

  // Use local AS for development
  if (document.location.host == 'localhost')
    fah.as_urls = ['http://localhost:8888'];
  else if (document.location.host == '127.0.0.1')
    fah.as_urls = ['http://127.0.0.1:8888'];


  // Open all links in new tab
  $('a').attr('target', '_blank');

  // Restore state
  if (config_get('paused')) pause_folding(false);

  load_identity();

  if (fah.user == null) {
    $('#no-registration-dialog').dialog({modal:true, closeOnEscape: false}).dialogNoClose();
    return;
  }

  // Power slider
  power_init();

  // Start stop button
  $('.folding-stop .button').on('click', pause_folding);
  $('.folding-start .button').on('click', unpause_folding);
  $('#nacl-error-dialog li').click(function () {
    $(this).find('p').slideToggle();
  });

  // Dialogs
  $('a.dialog-link').click(dialog_open_event);

  // Share Links
  var share_url = 'http%3A%2F%2Fnacl.foldingathome.org%2F';
  var share_text = 'Share+your+unused+computer+power+to+help+find+a+cure.';

  $('a.twitter').attr({href: '//twitter.com/share?url=' + share_url +
                       '&text=' + share_text});
  $('a.facebook').attr({href: '//www.facebook.com/sharer.php?u=' +
                        share_url + '&t=' + share_text});

  // Catch exit
  window.onbeforeunload = function (e) {
    if (fah.paused || typeof fah.wu == 'undefined')
      return;

    var message = 'If you choose to stay on this page Folding@home ' +
        'will finish its current work and then pause.  You can then ' +
        'leave with out losing any work.';

    fah.finish = true;
    message_display('Finishing current work unit', 30);

    e = e || window.event;
    if (e) e.returnValue = message; // For IE and Firefox
    return message; // For Safari
  };

  if (window.chrome) {
    // Get Chrome version
    fah.chrome_version =
      parseFloat(navigator.appVersion.match(/Chrome\/(\d+\.\d+)/)[1]);
    debug('Detected Chrome version ' + fah.chrome_version);

    if (fah.chrome_version < 31) {
      dialog_open_fatal('nacl-error-dialog');
      return;
    }

    // Start module watchdog
    watchdog_set(10000, module_timeout);

    // Start Module
    var core = document.getElementById('fahcore');
    core.addEventListener('loadstart', module_loading, true);
    core.addEventListener('progress', module_progress, true);
    core.addEventListener('load', module_loaded, true);
    core.addEventListener('message', module_message, true);
    core.addEventListener('error', module_error, true);
    core.addEventListener('crash', module_exit, true);

    module_insert();
  } else dialog_open_fatal('requires-chrome');

  // Google analytics
  _uacct = "UA-2993490-3";
  if (typeof urchinTracker != 'undefined') urchinTracker();
});
