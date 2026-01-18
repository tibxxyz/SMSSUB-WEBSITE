// Authentication JavaScript for SMS Subscription Site

// Check if user is logged in
function checkAuthStatus() {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) {
        // Redirect to login if not authenticated
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Login function
async function loginUser(email) {
    try {
        // Validate email format
        if (!isValidEmail(email)) {
            throw new Error('Invalid email format');
        }

        // Check if user exists
        const userExists = await checkUserInMainApp(email);

        if (!userExists) {
            throw new Error('Account not found. Please sign up to create a new account.');
        }

        // Store user session
        sessionStorage.setItem('userEmail', email);
        sessionStorage.setItem('loginTime', Date.now());

        // Check if there's a redirect parameter (e.g., for admin panel)
        const urlParams = new URLSearchParams(window.location.search);
        const redirect = urlParams.get('redirect');

        return { success: true, message: 'Login successful', redirect: redirect };

    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Signup function
async function signupUser(email) {
    try {
        // Validate email format
        if (!isValidEmail(email)) {
            throw new Error('Invalid email format');
        }

        // Check if user already exists
        const userExists = await checkUserInMainApp(email);

        if (userExists) {
            throw new Error('Account already exists. Please login instead.');
        }

        // Create new user account
        const newUser = await createUserAccount(email);

        // Store user session
        sessionStorage.setItem('userEmail', email);
        sessionStorage.setItem('loginTime', Date.now());
        sessionStorage.setItem('isNewUser', 'true');

        return { success: true, message: 'Account created successfully', user: newUser };

    } catch (error) {
        return { success: false, message: error.message };
    }
}

// Validate email format
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Check if user exists in main app (real API call)
async function checkUserInMainApp(email) {
    try {
        const response = await fetch('/api/users?action=validate-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email: email })
        });

        const data = await response.json();
        // Return true if user is valid (exists in database)
        return data.valid === true;
    } catch (error) {
        console.error('Error checking user in main app:', error);
        return false;
    }
}

// Create new user account in Firebase
async function createUserAccount(email) {
    try {
        const response = await fetch('/api/users?action=register-main-app-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                source: 'Website'
            })
        });

        const data = await response.json();

        if (data.success) {
            return {
                email: email,
                smsCredits: 0,
                createdAt: new Date().toISOString(),
                subscriptionStatus: 'inactive'
            };
        } else {
            throw new Error(data.error || 'Failed to create user account');
        }
    } catch (error) {
        console.error('Error creating user account:', error);
        throw error;
    }
}

// Logout function
function logout() {
    // Clear session data
    sessionStorage.removeItem('userEmail');
    sessionStorage.removeItem('loginTime');
    sessionStorage.removeItem('isNewUser');

    // Redirect to login
    window.location.href = 'login.html';
}

// Get current user data
function getCurrentUser() {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) return null;

    // Get user data from localStorage (in production, this would be an API call)
    const userData = localStorage.getItem(`user_${userEmail}`);
    return userData ? JSON.parse(userData) : null;
}

// Update user data
function updateUserData(userData) {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) return false;

    // Update user data in localStorage (in production, this would be an API call)
    localStorage.setItem(`user_${userEmail}`, JSON.stringify(userData));
    return true;
}

// Handle form submissions
document.addEventListener('DOMContentLoaded', function () {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = document.getElementById('email').value;
            const loginBtn = document.getElementById('loginBtn');
            const buttonText = loginBtn.querySelector('.button-text');
            const buttonLoading = loginBtn.querySelector('.button-loading');
            const emailError = document.getElementById('emailError');

            // Show loading state
            buttonText.style.display = 'none';
            buttonLoading.style.display = 'inline';
            loginBtn.disabled = true;
            emailError.style.display = 'none';

            try {
                const result = await loginUser(email);

                if (result.success) {
                    // Check for redirect parameter
                    if (result.redirect) {
                        window.location.href = result.redirect;
                    } else {
                        // Redirect to dashboard
                        window.location.href = 'dashboard.html';
                    }
                } else {
                    // Show error
                    emailError.textContent = result.message;
                    emailError.style.display = 'block';
                }
            } catch (error) {
                emailError.textContent = 'An error occurred. Please try again.';
                emailError.style.display = 'block';
            } finally {
                // Reset button state
                buttonText.style.display = 'inline';
                buttonLoading.style.display = 'none';
                loginBtn.disabled = false;
            }
        });
    }

    if (signupForm) {
        signupForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = document.getElementById('signupEmail').value;
            const confirmEmail = document.getElementById('confirmEmail').value;
            const signupBtn = document.getElementById('signupBtn');
            const buttonText = signupBtn.querySelector('.button-text');
            const buttonLoading = signupBtn.querySelector('.button-loading');
            const emailError = document.getElementById('signupEmailError');
            const confirmError = document.getElementById('confirmEmailError');

            // Clear previous errors
            emailError.style.display = 'none';
            confirmError.style.display = 'none';

            // Validate emails match
            if (email !== confirmEmail) {
                confirmError.textContent = 'Emails do not match';
                confirmError.style.display = 'block';
                return;
            }

            // Show loading state
            buttonText.style.display = 'none';
            buttonLoading.style.display = 'inline';
            signupBtn.disabled = true;

            try {
                const result = await signupUser(email);

                if (result.success) {
                    // Clear session - user needs to login after signup
                    sessionStorage.removeItem('userEmail');
                    sessionStorage.removeItem('loginTime');
                    sessionStorage.removeItem('isNewUser');

                    // Show success modal instead of redirecting
                    if (typeof showSuccessModal === 'function') {
                        showSuccessModal();
                    } else {
                        // Fallback if modal function not available
                        alert('Account created successfully! Please login.');
                        showLogin();
                    }
                } else {
                    // Show error
                    emailError.textContent = result.message;
                    emailError.style.display = 'block';
                }
            } catch (error) {
                emailError.textContent = 'An error occurred. Please try again.';
                emailError.style.display = 'block';
            } finally {
                // Reset button state
                buttonText.style.display = 'inline';
                buttonLoading.style.display = 'none';
                signupBtn.disabled = false;
            }
        });
    }
});

// Global functions for HTML onclick handlers
window.showSignup = function () {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'block';
};

window.showLogin = function () {
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
};

window.logout = logout;
