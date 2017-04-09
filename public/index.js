/*
 * This file is distributed under the terms of the ISC License.
 * See the file LICENSE at https://github.com/zozs/plants
 */

var plantsApp = angular.module('plantsApp', ['ui.bootstrap', 'chart.js']);

plantsApp.controller('PlantsCtrl', function($scope, $http, $uibModal) {
  $http.get('api/places').success(function(data) {
    $scope.places = data.places;
    $scope.sort();
  });

  $scope.addNewPlant = function (place) {
    $http.post(place.url + '/plants', { name: 'New plant' })
      .success(function (data) {
        place.plants.push(data.plant);
        $scope.sort();
      });
  };

  $scope.daysSinceWater = function(plant) {
    /* Return 'Never' if never watered. */
    if (plant.dates.length == 0) {
      return { text: 'Never', textAlt: '', days: Number.MAX_VALUE };
    }
    var plantDate = new Date(plant.dates[plant.dates.length - 1]);
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var days = Math.round((today - plantDate) / (1000 * 60 * 60 * 24));
    return { text: days,
             textAlt: '(' + plant.dates[plant.dates.length - 1] + ')',
             days: days
           };
  };

  $scope.editPlant = function (plant) {
    var modalInstance = $uibModal.open({
      animation: true,
      templateUrl: 'editPlantContent.html',
      controller: 'EditPlantInstanceCtrl',
      controllerAs: 'vm',
      size: 'lg',
      resolve: {
        plant: function () {
          return plant;
        }
      }
    });

    modalInstance.result.then(function (status) {
      // resort since we may have added more dates.
      $scope.sort();
      // check if we have deleted the plant, if so, remove it from the array.
      if (status === 'deleted') {
        for (var i = 0; i < $scope.places.length; i++) {
          var deletedIndex = $scope.places[i].plants.findIndex(function (e) {
            return (e.id === plant.id);
          });
          if (deletedIndex !== -1) {
            $scope.places[i].plants.splice(deletedIndex, 1);
          }
        }
      }
    }, function () {});
  };
  
  $scope.shouldBeHidden = function (showHidden) {
    return function (item) {
      return showHidden || !item.hidden;
    }
  };

  $scope.isWateredToday = function(plant) {
    var todayDate = new Date().toISOString().substring(0, 10);
    return plant.dates.length > 0 && todayDate == plant.dates[plant.dates.length - 1];
  };

  $scope.plantStatistics = function (plant) {
    var modalInstance = $uibModal.open({
      animation: true,
      templateUrl: 'plantStatisticsContent.html',
      controller: 'PlantStatisticsInstanceCtrl',
      controllerAs: 'vm',
      size: 'lg',
      resolve: {
        plant: function () {
          return plant;
        }
      }
    });

    modalInstance.result.then(function () {}, function () {});
  };

  $scope.sort = function () {
    for (var i = 0; i < $scope.places.length; i++) {
      $scope.places[i].plants.sort(function(a, b) {
        var ad = $scope.daysSinceWater(a).days;
        var bd = $scope.daysSinceWater(b).days;
        return bd - ad;
      });
    }
  };

  $scope.toggleHidePlace = function (place) {
    if (place.showHidden === undefined) {
      place.showHidden = false;
    }
    place.showHidden = !place.showHidden;
  };

  $scope.waterPlant = function (plant, dayOffset) {
    var date = new Date();
    date.setDate(date.getDate() + dayOffset);
    var dateString = date.toISOString().substring(0, 10);
    plant.dates.push(dateString); // put in success-handler instead?
    $scope.sort();
    $http.post(plant.url + '/dates', {date: dateString})
      .error(function(data, status, headers, config) {
        console.log('Failed to update date');
      });
  };
});

plantsApp.controller('EditPlantInstanceCtrl', function ($modalInstance, $http, $uibModal, plant) {
  var self = this;
  this.plant = plant;
  this.newName = plant.name;

  this.addDate = function (date) {
    date.setHours(0, -date.getTimezoneOffset(), 0, 0); //removing the timezone offset.
    var dateStr = date.toISOString().substring(0, 10);

    $http.post(plant.url + '/dates', {date: dateStr}).success(function () {
      plant.dates.push(dateStr);
      // sort here, or after returning?
      self.date = '';
    });
  };

  this.deleteDate = function (date, dateIndex) {
    $http.delete(plant.url + '/dates/' + date).success(function () {
      plant.dates.splice(dateIndex, 1);
    });
  };
  
  this.deletePlant = function () {
    var modalInstance = $uibModal.open({
      animation: true,
      templateUrl: 'deletePlantContent.html',
      size: 'sm',
    });
    modalInstance.result.then(function () {
      // delete.
      console.log('will delete plant');
      $http.delete(plant.url).success(function () {
        $modalInstance.close('deleted'); // signals to angular to delete this.
      });
    }, function () {
      // cancel
    });
  };

  this.ok = function () {
    $modalInstance.close();
  };

  this.setHidden = function (newHidden) {
    $http.put(plant.url, {name: plant.name, hidden: newHidden}).success(function () {
      plant.hidden = newHidden;
    });
  };

  this.saveName = function (newName) {
    $http.put(plant.url, {name: newName, hidden: plant.hidden}).success(function () {
      plant.name = newName;
    });
  };

  this.dateOpened = false;

  this.dateOptions = {
    formatYear: 'yyyy',
    startingDay: 1
  };

  this.open = function ($event) {
    self.dateOpened = true;
  };
});

plantsApp.controller('PlantStatisticsInstanceCtrl', function ($modalInstance, plant) {
  var self = this;
  this.plant = plant;
  this.stats = [];

  // Now, generate stats from the given plant data.
  
  // First we calculate all day differences, since we'll need them a lot.
  var dayDiffs = [];
  var prev = null;
  for (var i = 0; i < plant.dates.length; i++) {
    if (prev !== null) {
      var dayDiff = (new Date(plant.dates[i]) - prev) / (24 * 3600 * 1000);
      dayDiffs.push(dayDiff);
    }
    prev = new Date(plant.dates[i]);
  }

  // Average (mean) time between water.
  var avg = (function (diffs) {
    var sum = 0;
    for (var i = 0; i < diffs.length; i++) {
      sum += diffs[i];
    }
    return sum / diffs.length;
  })(dayDiffs);

  // Median.
  var median = (function (diffs) {
    if (diffs.length == 0) return 0.0;
    var sorted = diffs.slice(0); // clone
    sorted.sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 == 0) {
      // if even count, median = mean of two middle.
      return (sorted[middle-1] + sorted[middle]) / 2 + 0.0;
    } else {
      // if odd count, simply return middle element.
      return sorted[middle] + 0.0;
    }
  })(dayDiffs);

  // Max and min time between water.
  var shortest = Math.min.apply(self, dayDiffs);
  var longest = Math.max.apply(self, dayDiffs);

  // Standard deviation of time between water.
  var stddev = (function (diffs, avg) {
    var sum = 0;
    for (var i = 0; i < diffs.length; i++) {
      sum += (avg - diffs[i]) * (avg - diffs[i]);
    }
    return Math.sqrt(sum / diffs.length);
  })(dayDiffs, avg);
  

  this.stats.push({
    name: 'Mean time between water',
    value: avg
  });
  this.stats.push({
    name: 'Median time between water',
    value: median
  });
  this.stats.push({
    name: 'Standard deviation of time between water',
    value: stddev
  });
  this.stats.push({
    name: 'Longest time between water',
    value: longest
  });
  this.stats.push({
    name: 'Shortest time between water',
    value: shortest
  });

  this.histogram = {};
  this.timeline = {};

  // Generate histogram data.
  this.histogram = (function (diffs) {
    // Count the number of different values.
    var counts = {};
    for (var i = 0; i < diffs.length; i++) {
      if (!counts.hasOwnProperty(diffs[i])) {
        counts[diffs[i]] = 0;
      }
      counts[diffs[i]] += 1;
    }

    // Now sort by keys, and construct corresponding data array.
    var keys = Object.keys(counts);
    keys.sort(function (a, b) { return a - b; });
    var data = keys.map(function (e) {
      return counts[e];
    });
    return { series: ['Histogram'], labels: keys, data: [data] };
  })(dayDiffs);

  // Generate timeline data.
  this.timeline = (function (diffs) {
    // Assumes diffs is sorted by date already (should be)
    var labels = [];
    for (var i = 0; i < diffs.length; i++) {
      labels.push('');
    }
    return { series: ['Timeline'], data: [diffs], labels: labels};    
  })(dayDiffs);

  this.ok = function () {
    $modalInstance.close();
  };
});
