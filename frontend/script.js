// ========== DOM ELEMENTS ==========
const signUpButton = document.getElementById('signUp');
const signInButton = document.getElementById('signIn');
const container = document.getElementById('container');
const authLoader = document.getElementById('authLoader');

// Mobile Links
const signUpButtonMobile = document.getElementById('signUpMobile');
const signInButtonMobile = document.getElementById('signInMobile');

// Forms
const signUpForm = document.getElementById('signUpForm');
const signInForm = document.getElementById('signInForm');

// Success Modal
const successModal = document.getElementById('successModal');
const successMessage = document.getElementById('successMessage');

function showAuthLoader() {
    document.body.classList.add('auth-pending');
    if (authLoader) authLoader.classList.remove('is-hidden');
}

function revealLogin() {
    document.body.classList.remove('auth-pending');
    if (authLoader) authLoader.classList.add('is-hidden');
}

// ========== PANEL SWITCHING ==========
signUpButton.addEventListener('click', (e) => {
    e.preventDefault();
    container.classList.add('right-panel-active');
    resetForm(signInForm);
});

signInButton.addEventListener('click', (e) => {
    e.preventDefault();
    container.classList.remove('right-panel-active');
    resetForm(signUpForm);
});

signUpButtonMobile.addEventListener('click', (e) => {
    e.preventDefault();
    container.classList.add('right-panel-active');
    resetForm(signInForm);
});

signInButtonMobile.addEventListener('click', (e) => {
    e.preventDefault();
    container.classList.remove('right-panel-active');
    resetForm(signUpForm);
});

// ========== PASSWORD TOGGLE ==========
function initPasswordToggle() {
    const passwordToggles = document.querySelectorAll('.toggle-password');

    passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();

            const passwordField = this.parentElement.querySelector('input[type="password"], input[type="text"]');

            if (passwordField) {
                // Toggle password visibility
                if (passwordField.type === 'password') {
                    passwordField.type = 'text';
                    this.classList.remove('fa-eye-slash');
                    this.classList.add('fa-eye');
                } else {
                    passwordField.type = 'password';
                    this.classList.remove('fa-eye');
                    this.classList.add('fa-eye-slash');
                }

                // Add click animation
                this.style.transform = 'translateY(-50%) scale(1.2)';
                setTimeout(() => {
                    this.style.transform = 'translateY(-50%) scale(1)';
                }, 200);
            }
        });
    });
}

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPasswordToggle);
} else {
    initPasswordToggle();
}

// ========== PASSWORD STRENGTH CHECKER ==========
const signUpPassword = document.getElementById('pass-up');
const strengthBar = document.querySelector('.strength-bar');
const strengthText = document.querySelector('.strength-text');
const passwordStrengthContainer = document.querySelector('.password-strength');

if (signUpPassword) {
    signUpPassword.addEventListener('input', function () {
        const password = this.value;

        if (password.length === 0) {
            passwordStrengthContainer.classList.remove('show');
            strengthBar.className = 'strength-bar';
            strengthText.textContent = '';
            return;
        }

        passwordStrengthContainer.classList.add('show');
        const strength = calculatePasswordStrength(password);

        strengthBar.className = 'strength-bar ' + strength.level;
        strengthText.textContent = strength.text;
        strengthText.style.color = strength.color;
    });
}

function calculatePasswordStrength(password) {
    let strength = 0;

    // Length check
    if (password.length >= 8) strength += 1;
    if (password.length >= 12) strength += 1;

    // Character variety checks
    if (/[a-z]/.test(password)) strength += 1;
    if (/[A-Z]/.test(password)) strength += 1;
    if (/[0-9]/.test(password)) strength += 1;
    if (/[^a-zA-Z0-9]/.test(password)) strength += 1;

    if (strength <= 2) {
        return { level: 'weak', text: 'Weak password', color: '#ff4757' };
    } else if (strength <= 4) {
        return { level: 'medium', text: 'Medium password', color: '#ffa502' };
    } else {
        return { level: 'strong', text: 'Strong password', color: '#2ed573' };
    }
}

// ========== FORM VALIDATION ==========
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function showError(input, message) {
    const inputContainer = input.parentElement;
    const errorMessage = inputContainer.querySelector('.error-message');

    input.classList.add('error');
    input.classList.remove('success');
    errorMessage.textContent = message;
    errorMessage.classList.add('show');

    // Add shake animation
    input.style.animation = 'none';
    setTimeout(() => {
        input.style.animation = 'shake 0.5s ease';
    }, 10);
}

function showSuccess(input) {
    const inputContainer = input.parentElement;
    const errorMessage = inputContainer.querySelector('.error-message');

    input.classList.remove('error');
    input.classList.add('success');
    errorMessage.textContent = '';
    errorMessage.classList.remove('show');
}

function validateInput(input) {
    const value = input.value.trim();
    let isValid = true;

    if (value === '') {
        showError(input, 'This field is required');
        isValid = false;
    } else if (input.type === 'email' && !validateEmail(value)) {
        showError(input, 'Please enter a valid email');
        isValid = false;
    } else if (input.hasAttribute('minlength')) {
        const minLength = parseInt(input.getAttribute('minlength'));
        if (value.length < minLength) {
            showError(input, `Minimum ${minLength} characters required`);
            isValid = false;
        } else {
            showSuccess(input);
        }
    } else {
        showSuccess(input);
    }

    return isValid;
}

// Real-time validation
const allInputs = document.querySelectorAll('input[required]');
allInputs.forEach(input => {
    input.addEventListener('blur', () => {
        if (input.value.trim() !== '') {
            validateInput(input);
        }
    });

    input.addEventListener('input', () => {
        if (input.classList.contains('error')) {
            validateInput(input);
        }
    });
});

// ========== API Configuration ==========
const API_URL = window.API_URL || 'http://localhost:4000';

async function redirectIfAuthenticated() {
    const storedToken = localStorage.getItem('token');
    if (!storedToken) {
        revealLogin();
        return;
    }
    showAuthLoader();
    let redirected = false;
    try {
        const response = await fetch(`${API_URL}/auth/me`, {
            headers: {
                'Authorization': `Bearer ${storedToken}`
            }
        });
        const data = await response.json();
        if (data.success && data.user && data.user.role) {
            const target = data.user.role === 'owner'
                ? 'owner-dashboard.html'
                : (data.user.role === 'admin' ? 'admin-dashboard.html' : 'member-dashboard.html');
            redirected = true;
            window.location.replace(target);
            return;
        } else {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    } finally {
        if (!redirected) revealLogin();
    }
}

redirectIfAuthenticated();

// ========== COOL NOTIFICATION SYSTEM ==========
function showNotification(message, type = 'info', title = '') {
    const container = document.getElementById('notificationContainer');

    // Icon mapping
    const icons = {
        error: 'fa-circle-xmark',
        success: 'fa-circle-check',
        warning: 'fa-triangle-exclamation',
        info: 'fa-circle-info'
    };

    // Title mapping
    const titles = {
        error: title || 'Error!',
        success: title || 'Success!',
        warning: title || 'Warning!',
        info: title || 'Info'
    };

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification-toast ${type}`;
    notification.innerHTML = `
        <div class="notification-icon">
            <i class="fa-solid ${icons[type]}"></i>
        </div>
        <div class="notification-content">
            <div class="notification-title">${titles[type]}</div>
            <div class="notification-message">${message}</div>
        </div>
        <div class="notification-close">
            <i class="fa-solid fa-xmark"></i>
        </div>
        <div class="notification-progress"></div>
    `;

    container.appendChild(notification);

    // Close button functionality
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
        removeNotification(notification);
    });

    // Auto remove after 3 seconds
    setTimeout(() => {
        removeNotification(notification);
    }, 3000);
}

function removeNotification(notification) {
    notification.classList.add('hiding');
    setTimeout(() => {
        notification.remove();
    }, 300);
}

// ========== FORM SUBMISSION ==========
signUpForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username-up');
    const studentId = document.getElementById('student-id-up');
    const email = document.getElementById('email-up');
    const password = document.getElementById('pass-up');

    // Validate all fields
    const isUsernameValid = validateInput(username);
    const isStudentIdValid = validateInput(studentId);
    const isEmailValid = validateInput(email);
    const isPasswordValid = validateInput(password);

    if (isUsernameValid && isStudentIdValid && isEmailValid && isPasswordValid) {
        // Show loading state
        const submitBtn = signUpForm.querySelector('button[type="submit"]');
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;

        // AbortController for 45s timeout matching Render's cold start
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        // Show waking up info if taking long
        const wakeupWarningId = setTimeout(() => {
            showNotification('Server is waking up (might take up to 50s). Please wait...', 'info', 'Connecting...');
        }, 6000);

        try {
            // Real API call
            const response = await fetch(`${API_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: username.value,
                    studentId: studentId.value,
                    email: email.value,
                    password: password.value
                }),
                signal: controller.signal
            });

            clearTimeout(wakeupWarningId);
            clearTimeout(timeoutId);
            const data = await response.json();

            // Remove loading state
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            if (data.success) {
                // Store token in localStorage
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));

                // Redirect to dashboard based on role
                if (data.user.role === 'owner') {
                    window.location.replace('owner-dashboard.html');
                } else if (data.user.role === 'admin') {
                    window.location.replace('admin-dashboard.html');
                } else {
                    window.location.replace('member-dashboard.html');
                }
            } else {
                // Show error notification
                showNotification(data.message || 'Registration failed!', 'error');
            }

        } catch (error) {
            clearTimeout(wakeupWarningId);
            clearTimeout(timeoutId);
            // Remove loading state
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            console.error('Registration error:', error);
            if (error.name === 'AbortError') {
                showNotification('Connection timed out! Database might be sleeping or server is unresponsive.', 'error', 'Timeout');
            } else {
                showNotification('Server error! Make sure backend is running.', 'error');
            }
        }
    }
});

signInForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username-in');
    const password = document.getElementById('pass-in');

    // Validate all fields
    const isUsernameValid = validateInput(username);
    const isPasswordValid = validateInput(password);

    if (isUsernameValid && isPasswordValid) {
        // Show loading state
        const submitBtn = signInForm.querySelector('button[type="submit"]');
        submitBtn.classList.add('loading');
        submitBtn.disabled = true;

        // AbortController for 45s timeout matching Render's cold start
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        // Show waking up info if taking long
        const wakeupWarningId = setTimeout(() => {
            showNotification('Server is waking up (might take up to 50s). Please wait...', 'info', 'Connecting...');
        }, 6000);

        try {
            // Real API call
            const response = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username: String(username.value || '').trim(),
                    password: String(password.value || '')
                }),
                signal: controller.signal
            });

            clearTimeout(wakeupWarningId);
            clearTimeout(timeoutId);
            const data = await response.json();

            // Remove loading state
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            if (data.success) {
                // Store token in localStorage
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));

                // Redirect to dashboard based on role
                if (data.user.role === 'owner') {
                    window.location.replace('owner-dashboard.html');
                } else if (data.user.role === 'admin') {
                    window.location.replace('admin-dashboard.html');
                } else {
                    window.location.replace('member-dashboard.html');
                }
            } else {
                // Show error notification with detailed message
                console.error('Login failed:', data);
                showNotification(data.message || 'Login failed! Please check your credentials.', 'error');
            }

        } catch (error) {
            clearTimeout(wakeupWarningId);
            clearTimeout(timeoutId);
            // Remove loading state
            submitBtn.classList.remove('loading');
            submitBtn.disabled = false;

            console.error('Login error:', error);
            if (error.name === 'AbortError') {
                showNotification('Connection timed out! Database might be sleeping or server is unresponsive.', 'error', 'Timeout');
            } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                showNotification(`Cannot connect to server! Please make sure backend server is running on ${API_URL}`, 'error');
            } else {
                showNotification('Server error! Please try again. ' + error.message, 'error');
            }
        }
    }
});

// ========== SUCCESS MODAL ==========
function showSuccessModal() {
    successModal.classList.add('show');
}

function hideSuccessModal() {
    successModal.classList.remove('show');
}

// Close modal on click outside
successModal.addEventListener('click', (e) => {
    if (e.target === successModal) {
        hideSuccessModal();
    }
});

// ========== RESET FORM ==========
function resetForm(form) {
    form.reset();
    const inputs = form.querySelectorAll('input');
    inputs.forEach(input => {
        input.classList.remove('error', 'success');
        const errorMessage = input.parentElement.querySelector('.error-message');
        if (errorMessage) {
            errorMessage.textContent = '';
            errorMessage.classList.remove('show');
        }
    });

    // Reset password strength indicator
    if (form === signUpForm) {
        passwordStrengthContainer.classList.remove('show');
        strengthBar.className = 'strength-bar';
        strengthText.textContent = '';
    }
}

// ========== SMOOTH SCROLL & ANIMATIONS ==========
// Add entrance animation to form elements
window.addEventListener('load', () => {
    const formElements = document.querySelectorAll('.input-container, button, label');
    formElements.forEach((element, index) => {
        element.style.animationDelay = `${index * 0.1}s`;
    });
});

// ========== KEYBOARD NAVIGATION ==========
document.addEventListener('keydown', (e) => {
    // Close modal with Escape key
    if (e.key === 'Escape' && successModal.classList.contains('show')) {
        hideSuccessModal();
    }
});

// ========== INPUT FOCUS EFFECTS ==========
const inputs = document.querySelectorAll('input');
inputs.forEach(input => {
    input.addEventListener('focus', function () {
        this.parentElement.style.transform = 'translateY(-2px)';
        this.parentElement.style.transition = 'transform 0.3s ease';
    });

    input.addEventListener('blur', function () {
        this.parentElement.style.transform = 'translateY(0)';
    });
});

// ========== FORGOT PASSWORD ==========
const forgotPasswordLink = document.querySelector('.forgot-password');
if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        successMessage.textContent = 'Password reset link sent to your email!';
        showSuccessModal();
        setTimeout(() => {
            hideSuccessModal();
        }, 3000);
    });
}

// ========== CONSOLE WELCOME MESSAGE ==========
console.log('%c🎉 Welcome to the Enhanced Login Form!', 'color: #667eea; font-size: 20px; font-weight: bold;');
console.log('%c✨ Features: Form Validation, Password Strength, Smooth Animations, and more!', 'color: #764ba2; font-size: 14px;');
