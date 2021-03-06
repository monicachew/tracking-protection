"use strict";

// Telemetry histograms.
var requiredMeasures = {
  "TRACKING_PROTECTION_SHIELD" : 0,
  "TRACKING_PROTECTION_ENABLED" : 1,
  "TRACKING_PROTECTION_EVENTS" : 2,
};

// Dates to use for the paper
var minDate = new Date(2014, 11, 24);
var endDate = new Date(2015, 0, 1);

// Versions for which we have any data.
var channels = {
  nightly: [ "nightly/35", "nightly/36", "nightly/37", "nightly/38" ],
  aurora: [ "aurora/35", "aurora/36", "aurora/37" ],
  beta: [ "beta/35", "beta/36" ]
};
var currentChannel = "nightly";

// Minimum volume for which to display data
var minVolume = 1000;

// Array of [[version, measure]] for requesting loadEvolutionOverBuilds.
var versionedMeasures = [];

// Set up our series
var tsSeries = {};
var volumeSeries = {};
var enabled = [];
var events = {};
// Setup our highcharts on document-ready.
$(document).ready(function() {
  tsChart = new Highcharts.StockChart(tsOptions);
  volumeChart = new Highcharts.StockChart(volumeOptions);
  enabledChart = new Highcharts.StockChart(enabledOptions);
  eventChart = new Highcharts.StockChart(eventOptions);
});

// Print auxiliary function
function print(line) {
  document.querySelector('#output').textContent += line + "\n";
};

function changeView(channel) {
  // Unselect the old channel
  document.querySelector("#" + currentChannel)
      .setAttribute("style", "background-color:white");
  print("Current channel: ", channel);
  currentChannel = channel;
  makeGraphsForChannel(currentChannel);
  // Select the new channel. The highlighted button uses the same green color as
  // Highcharts.
  document.querySelector("#" + currentChannel)
    .setAttribute("style", "background-color:#90ed7d");
}

// Initialize telemetry.js
Telemetry.init(function() {
  print("Stats for 12/25-1/1");

  // For nightly versions, we only have one release per date, so we can
  // construct a single graph for all versions of nightly.
  print("changing view");
  changeView("nightly");
});

function makeGraphsForChannel(channel) {
  for (var i = 0; i < 3; i++) {
    tsSeries[i] = [];
    volumeSeries[i] = [];
    events[i] = [];
  }
  makeTimeseries(channel, channels[channel]);
}
// Sort [date, {rate|volume}] pairs based on the date
function sortByDate(p1, p2)
{
  return p1[0] - p2[0];
}

// Filter duplicate dates to account for screwed up telemetry data
function filterDuplicateDates(series)
{
  // Work on a copy so we don't cause side-effects without realizing.
  var s = series.sort(sortByDate);

  // Series is an array of pairs [[date, volume]]. If successive dates have the
  // same volume, delete
  var t = [];
  for (var i = 0; i < s.length; i++) {
    if (s[i][1] != 0) {
      t.push(s[i]);
    }
  }
  return t.sort(sortByDate);
}

function normalizeSeries(series)
{
  return filterDuplicateDates(series.sort(sortByDate));
}

// Returns a promise that resolves when all of the versions for all of the
// required measures have been stuffed into the timeseries.
function makeTimeseries(channel, versions)
{
  // construct a single graph for all versions of nightly
  var promises = [];
  versions.forEach(function(v) {
    promises.push(makeTimeseriesForVersion(v));
  });
  return Promise.all(promises)
    .then(function() {
      // Wait until all of the series data has been returned before redrawing
      // highcharts.
      for (var i = 0; i < 3; i++) {
        tsSeries[i] = normalizeSeries(tsSeries[i]);
        tsChart.series[i].setData(tsSeries[i], true);
        volumeSeries[i] = normalizeSeries(volumeSeries[i]);
        volumeChart.series[i].setData(volumeSeries[i], true);
        events[i] = normalizeSeries(events[i]);
        eventChart.series[i].setData(events[i], true);
      }
      enabled = normalizeSeries(enabled);
      enabledChart.series[0].setData(enabled, true);
    });
}

// Returns a promise that resolves when all of the requires measures from the
// given version have had their timeseries added.
function makeTimeseriesForVersion(v)
{
  var promises = [];
  var p = new Promise(function(resolve, reject) {
    Telemetry.measures(v, function(measures) {
      for (var m in measures) {
        // Telemetry.loadEvolutionOverBuilds(v, m) never calls the callback if
        // the given measure doesn't exist for that version, so we must make
        // sure to only call makeTimeseries for measures that exist.
        if (m in requiredMeasures) {
          if (m == "TRACKING_PROTECTION_SHIELD") {
            promises.push(makeTimeseriesForMeasure(v, m));
          } else if (m == "TRACKING_PROTECTION_ENABLED") {
            promises.push(makeTimeseriesForEnabled(v, m));
          } else {
            promises.push(makeTimeseriesForEvents(v, m));
          }
        }
      }
      resolve(Promise.all(promises));
    });
  });
  return p;
}

// Returns a promise that resolves when all of the data has been loaded for a
// particular measure. Don't redraw highcharts here because appending to the
// existing series data will cause a race condition in the event of multiple
// versions.
function makeTimeseriesForMeasure(version, measure) {
  var total = 0;
  var blocked = 0;
  var loaded = 0;
  var p = new Promise(function(resolve, reject) {
    Telemetry.loadEvolutionOverBuilds(version, measure,
      function(histogramEvolution) {
        histogramEvolution.each(function(date, histogram) {
          var data = histogram.map(function(count, start, end, index) {
            return count;
          });
          // Skip dates with fewer than minVolume submissions
          date.setUTCHours(0);
          var volume = data[0] + data[1] + data[2] + data[3];
          if (volume > minVolume && date > minDate) {
            // Not shown = 0, loaded = 1, blocked = 2, mixed content = 3
            tsSeries[0].push([date.getTime(), (data[0] + data[3]) / volume]);
            volumeSeries[0].push([date.getTime(), data[0] + data[3]]);

            tsSeries[1].push([date.getTime(), data[1] / volume]);
            volumeSeries[1].push([date.getTime(), data[1]]);

            tsSeries[2].push([date.getTime(), data[2] / volume]);
            volumeSeries[2].push([date.getTime(), data[2]]);
            if (date < endDate) {
              total += volume;
              loaded += data[1];
              blocked += data[2];
            }
          }
        });
        // We've collected all of the data for this version, so resolve.
        resolve(true);
        /*
        if (total != 0) {
          print("Total loads: " + total);
          print("Blocked (shield showing): " + blocked);
          print("Loaded (strike shield showing): " + loaded);
        }
        */
      }
    );
  });
  return p;
}

// Returns a promise that resolves when all of the data has been loaded for a
// particular measure. Don't redraw highcharts here because appending to the
// existing series data will cause a race condition in the event of multiple
// versions.
function makeTimeseriesForEnabled(version, measure) {
  var total = 0;
  var enabled_sessions = 0;
  var p = new Promise(function(resolve, reject) {
    Telemetry.loadEvolutionOverBuilds(version, measure,
      function(histogramEvolution) {
        histogramEvolution.each(function(date, histogram) {
          var data = histogram.map(function(count, start, end, index) {
            return count;
          });
          date.setUTCHours(0);
          // Skip dates newer than a week old
          var volume = data[0] + data[1];
          if (date < (new Date() - 7 * 24 * 3600 * 1000)) {
            // 0 = disabled, 1 = enabled
            enabled.push([date.getTime(), data[1] / volume]);
            if (date > minDate && date < endDate) {
              total += volume;
              enabled_sessions += data[1];
            }
          }
        });
        // We've collected all of the data for this version, so resolve.
        resolve(true);
        /*
        if (enabled_sessions != 0) {
          print("Total sessions: " + total);
          print("Enabled sessions: " + enabled_sessions);
        }
        */
      }
    );
  });
  return p;
}

// Returns a promise that resolves when all of the data has been loaded for a
// particular measure. Don't redraw highcharts here because appending to the
// existing series data will cause a race condition in the event of multiple
// versions.
function makeTimeseriesForEvents(version, measure) {
  var minDate = new Date(2014, 11, 24);
  var disabled = 0;
  var enabled = 0;
  var p = new Promise(function(resolve, reject) {
    Telemetry.loadEvolutionOverBuilds(version, measure,
      function(histogramEvolution) {
        histogramEvolution.each(function(date, histogram) {
          var data = histogram.map(function(count, start, end, index) {
            return count;
          });
          date.setUTCHours(0);
          var volume = data[0] + data[1] + data[2];
          // Skip dates newer than a week old
          if (date < (new Date() - 7 * 24 * 3600 * 1000)) {
            // 0 = no action? 1 = disabled, 2 = re-enabled
            //events[0].push([date.getTime(), data[0]])
            events[0].push([date.getTime(), data[1]]);
            events[1].push([date.getTime(), data[2]]);
            if (date > minDate && date < endDate) {
              disabled += data[1];
              enabled += data[2];
            }
          }
        });
        // We've collected all of the data for this version, so resolve.
        resolve(true);
        /*
        if (disabled != 0) {
          print("Disabled clicks: " + disabled);
          print("Re-enabled clicks: " + enabled);
        }
        */
      }
    );
  });
  return p;
}
