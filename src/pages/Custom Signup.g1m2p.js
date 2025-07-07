// API Reference: https://www.wix.com/velo/reference/api-overview/introduction
// “Hello, World!” Example: https://learn-code.wix.com/en/article/1-hello-world

$w.onReady(function () {
    // Event listener for the eye icon
    $w("#viewPassowrd").onMouseIn(() => {
 $w("#input1").inputType = "text";
    });
    $w("#viewPassowrd").onMouseOut(() => {
         $w("#input1").inputType = "password";
    });
});
