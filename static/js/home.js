//home.js
console.log("User object from Flask will be here later");

function initUser(user) {
    console.log("User object:", user);
    console.log("User email:", user.email);
}

if (window.userData && window.userData.email) {
    console.log("Home page loaded for user:", window.userData.email);
}


document.addEventListener('DOMContentLoaded', function() {

    const buttons = document.querySelectorAll('.button');
    buttons.forEach(button => {
        button.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
        });
        button.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });

    const progressBar = document.querySelector('.progress');
    if (progressBar) {
        setTimeout(() => {
            progressBar.style.transition = 'width 1s ease';
        }, 100);
    }
});
