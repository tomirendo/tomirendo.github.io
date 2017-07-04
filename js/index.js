angular.module('myApp',['ngMaterial'])
.controller('ProductController', function( $scope, $products, $mdMedia,$mdToast) {
    $scope.$mdMedia           = $mdMedia;

    var max_cat = 21;


  var last = {
      bottom: false,
      top: true,
      left: true,
      right: false  
    };

    $scope.is_cat = {
      1 : true,
      2 : true,
      3 : true,
      4 : true,
      5 : true,
      6 : true,
      7 : false,
      8 : false,
      9 : false ,
      10 : false,
      11 : false ,
      12 : false ,
      13 : false ,
      14 : false ,
      15 : false ,
      16 : false ,
      17 : true,
      18 : true ,
      19 : true,
      20 : true,
      21 : true
          };

$scope.warning_class = "alert";
$scope.warning = "Make your guess";
  $scope.image = 1;
  $scope.past_images = [];
  $scope.toastPosition = angular.extend({},last);

  $scope.getToastPosition = function() {
    sanitizePosition();

    return Object.keys($scope.toastPosition)
      .filter(function(pos) { return $scope.toastPosition[pos]; })
      .join(' ');
  };

    function sanitizePosition() {
    var current = $scope.toastPosition;

    if ( current.bottom && last.top ) current.top = false;
    if ( current.top && last.bottom ) current.bottom = false;
    if ( current.right && last.left ) current.left = false;
    if ( current.left && last.right ) current.right = false;

    last = angular.extend({},current);
  }


  $scope.next_image = function(input){
    var rnd = 1;
    $scope.past_images += [$scope.image];
    var is_cat = $scope.is_cat[$scope.image];
    if (is_cat){
      if (input){
        $scope.showCat();
      } else {
        $scope.showErrorCat();
      }
    } else {
      if (input){
        $scope.showErrorBalls();
      } else{
        $scope.showBalls();
      }
    }

    if ($scope.past_images.length != max_cat){
    if ($scope.past_images == 1){
      rnd= 20;
    } else if ($scope.past_images == 20){
      rnd = 13;
    }else {
    while ($scope.past_images.indexOf(rnd) != -1){
      rnd = parseInt(Math.random()*max_cat) +1;
    }
  }
  }
   $scope.image = rnd;
};
      $scope.showErrorCat= function() {
        $scope.warning_class = "alert-danger";
        $scope.warning ="No, it was a cat...";

    };

   $scope.showCat= function() {
        $scope.warning_class = "alert-success";
        $scope.warning ="Yes! it was a cat!";

    };

   $scope.showErrorBalls= function() {
        $scope.warning_class = "alert-danger";
        $scope.warning ="No, These were testicles";

    };

      $scope.showBalls= function() {

       $scope.warning_class = "alert-success";
        $scope.warning ="Yes! You are correct";

  };
})
.factory('$products',function(){
  return {
    availableFilters : ["All Jackets","2016","jacket","Jackets","layers","Obermeyer","Roxy","womens"],
    availableSorts   : ["Featured","Best Selling","Alphabetically, A-Z","Alphabetically, Z-A","Price, low to high","Price, high to low","Date, new to old","Date, old to new"],
    catalog : makeJackets()    
  };
  
  function makeJackets() {    
    var list=[ ], master = {
      imageURL : "https://cdn.shopify.com/s/files/1/0938/8938/products/10231100205_1_1315x1800_300_CMYK_1024x1024.jpeg?v=1445623369",
      title : "Winter Jacket",
      price : "$99.99"
    }
    
    for (var j=0;j<2;j++) {
      list.push(angular.extend({},master));
    }    
    return list;    
  }


  
})