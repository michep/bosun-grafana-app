"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// TODO THIS IS HACK Figure out how to import this from app/core/data_table instead of copying and pasting the code
// But tables work now

var TableModel = exports.TableModel = function () {
  function TableModel() {
    _classCallCheck(this, TableModel);

    this.columns = [];
    this.rows = [];
    this.type = 'table';
  }

  _createClass(TableModel, [{
    key: "sort",
    value: function sort(options) {
      if (options.col === null || this.columns.length <= options.col) {
        return;
      }

      this.rows.sort(function (a, b) {
        a = a[options.col];
        b = b[options.col];
        if (a < b) {
          return -1;
        }
        if (a > b) {
          return 1;
        }
        return 0;
      });

      this.columns[options.col].sort = true;

      if (options.desc) {
        this.rows.reverse();
        this.columns[options.col].desc = true;
      }
    }
  }]);

  return TableModel;
}();

var BosunDatasource = exports.BosunDatasource = function () {
  function BosunDatasource(instanceSettings, $q, backendSrv, templateSrv) {
    _classCallCheck(this, BosunDatasource);

    this.type = instanceSettings.type;
    this.url = instanceSettings.url;
    this.name = instanceSettings.name;
    this.q = $q;
    this.backendSrv = backendSrv;
    this.templateSrv = templateSrv;
  }

  _createClass(BosunDatasource, [{
    key: "makeTable",
    value: function makeTable(result) {
      console.log(TableModel);
      var table = new TableModel();
      if (Object.keys(result).length < 1) {
        return table;
      }
      var tagKeys = [];
      _.each(result[0].Group, function (v, tagKey) {
        tagKeys.push(tagKey);
      });
      tagKeys.sort();
      table.columns = _.map(tagKeys, function (tagKey) {
        return { "text": tagKey };
      });
      table.columns.push({ "text": "value" });
      _.each(result, function (res) {
        var row = [];
        _.each(res.Group, function (tagValue, tagKey) {
          row[tagKeys.indexOf(tagKey)] = tagValue;
        });
        row.push(res.Value);
        table.rows.push(row);
      });
      return [table];
    }
  }, {
    key: "transformMetricData",
    value: function transformMetricData(result, target, options) {
      var tagData = [];
      _.each(result.Group, function (v, k) {
        tagData.push({ 'value': v, 'key': k });
      });
      var sortedTags = _.sortBy(tagData, 'key');
      var metricLabel = "";
      if (target.alias) {
        var scopedVars = _.clone(options.scopedVars || {});
        _.each(sortedTags, function (value) {
          scopedVars['tag_' + value.key] = { "value": value.value };
        });
        metricLabel = templateSrv.replace(target.alias, scopedVars);
      } else {
        tagData = [];
        _.each(sortedTags, function (tag) {
          tagData.push(tag.key + '=' + tag.value);
        });
        metricLabel = '{' + tagData.join(', ') + '}';
      }
      var dps = [];
      _.each(result.Value, function (v, k) {
        dps.push([v, parseInt(k) * 1000]);
      });
      return { target: metricLabel, datapoints: dps };
    }
  }, {
    key: "performTimeSeriesQuery",
    value: function performTimeSeriesQuery(query, target, options) {
      var exprDate = options.range.to.utc().format('YYYY-MM-DD');
      var exprTime = options.range.to.utc().format('HH:mm:ss');
      var url = this.url + '/api/expr?date=' + encodeURIComponent(exprDate) + '&time=' + encodeURIComponent(exprTime);
      return this.backendSrv.datasourceRequest({
        url: url,
        method: 'POST',
        data: query,
        datasource: this
      }).then(function (response) {
        if (response.status === 200) {
          var result;
          if (response.data.Type === 'series') {
            result = _.map(response.data.Results, function (result) {
              return response.config.datasource.transformMetricData(result, target, options);
            });
          }
          if (response.data.Type === 'number') {
            result = response.config.datasource.makeTable(response.data.Results);
          }
          return { data: result };
        }
      });
    }
  }, {
    key: "query",
    value: function query(options) {

      var queries = [];
      // Get time values to replace $start
      // The end time is what bosun regards as 'now'
      var secondsAgo = options.range.to.diff(options.range.from.utc(), 'seconds');
      secondsAgo += 's';
      _.each(options.targets, _.bind(function (target) {
        if (!target.expr || target.hide) {
          return;
        }
        var query = {};

        query = this.templateSrv.replace(target.expr, options.scopedVars);
        query = query.replace(/\$start/g, secondsAgo);
        query = query.replace(/\$ds/g, options.interval);
        queries.push(query);
      }, this));

      // No valid targets, return the empty result to save a round trip.
      if (_.isEmpty(queries)) {
        var d = this.q.defer();
        d.resolve({ data: [] });
        return d.promise;
      }

      var allQueryPromise = _.map(queries, _.bind(function (query, index) {
        return this.performTimeSeriesQuery(query, options.targets[index], options);
      }, this));

      return this.q.all(allQueryPromise).then(function (allResponse) {
        var result = [];
        _.each(allResponse, function (response) {
          _.each(response.data, function (d) {
            result.push(d);
          });
        });
        return { data: result };
      });
    }

    // Required
    // Used for testing datasource in datasource configuration pange

  }, {
    key: "testDatasource",
    value: function testDatasource() {
      return this.backendSrv.datasourceRequest({
        url: this.url + '/',
        method: 'GET'
      }).then(function (response) {
        if (response.status === 200) {
          return { status: "success", message: "Data source is working", title: "Success" };
        }
      });
    }
  }]);

  return BosunDatasource;
}();
//# sourceMappingURL=datasource.js.map