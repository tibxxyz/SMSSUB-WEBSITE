// Dashboard JavaScript for SMS Subscription Site

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', function () {
    // Check if user is authenticated
    if (!checkAuthStatus()) {
        return;
    }

    // Load user data and display dashboard
    loadDashboard();
});

// Check authentication status
function checkAuthStatus() {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Load dashboard data
async function loadDashboard() {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) return;

    // Display user email
    document.getElementById('userEmail').textContent = userEmail;

    // Load user data
    const userData = await getUserData(userEmail);
    if (userData) {
        displayUserData(userData);
    } else {
        // Create new user if not found
        const newUser = await createNewUser(userEmail);
        displayUserData(newUser);
    }

    // Load payment history
    await loadPaymentHistory();

    // Check for payment confirmations
    await checkPaymentConfirmations();

    // Start auto-refresh
    startAutoRefresh();
}

// Get user data from Firebase API
async function getUserData(email) {
    try {
        const response = await fetch('/api/get-user-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userEmail: email })
        });

        const data = await response.json();

        if (data.success) {
            return data.data;
        } else {
            console.error('Error getting user data:', data.error);
            return null;
        }
    } catch (error) {
        console.error('Error fetching user data:', error);
        return null;
    }
}

// Create new user if not found (register in Firebase)
async function createNewUser(email) {
    try {
        // Register user via API which will create Firebase entry with SMS credits initialized
        const response = await fetch('/api/register-main-app-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email,
                name: '',
                location: '',
                country: ''
            })
        });

        const data = await response.json();

        if (data.success) {
            // Return default user structure
            return {
                email: email,
                smsCredits: 0,
                totalSent: 0,
                thisMonthSent: 0,
                lastUsed: null,
                subscriptionStatus: 'inactive',
                createdAt: new Date().toISOString(),
                recentActivity: []
            };
        } else {
            throw new Error(data.error || 'Failed to create user');
        }
    } catch (error) {
        console.error('Error creating new user:', error);
        // Return default structure even if API call fails
        return {
            email: email,
            smsCredits: 0,
            totalSent: 0,
            thisMonthSent: 0,
            lastUsed: null,
            subscriptionStatus: 'inactive',
            createdAt: new Date().toISOString(),
            recentActivity: []
        };
    }
}

// Display user data on dashboard
function displayUserData(userData) {
    // Display credits
    document.getElementById('creditsCount').textContent = userData.smsCredits;

    // Display credits status
    const creditsStatus = document.getElementById('creditsStatus');
    if (userData.smsCredits > 0) {
        creditsStatus.textContent = `${userData.smsCredits} credits available`;
        creditsStatus.style.color = '#28a745';
    } else {
        creditsStatus.textContent = 'No credits - Buy some to start sending SMS';
        creditsStatus.style.color = '#dc3545';
    }

    // Display usage stats
    document.getElementById('totalSent').textContent = userData.totalSent || 0;
    document.getElementById('thisMonth').textContent = userData.thisMonthSent || 0;
    document.getElementById('lastUsed').textContent = userData.lastUsed ?
        formatDate(userData.lastUsed) : 'Never';

    // Display recent activity
    displayRecentActivity(userData.recentActivity || []);
}

// Display recent activity
function displayRecentActivity(activities) {
    const activityList = document.getElementById('activityList');

    if (activities.length === 0) {
        activityList.innerHTML = '<div class="no-activity">No recent activity</div>';
        return;
    }

    const activityHTML = activities.map(activity => `
        <div class="activity-item">
            <div class="activity-icon">📱</div>
            <div class="activity-details">
                <div class="activity-title">SMS sent to ${activity.recipient}</div>
                <div class="activity-time">${formatDate(activity.timestamp)}</div>
            </div>
            <div class="activity-status">${activity.status}</div>
        </div>
    `).join('');

    activityList.innerHTML = activityHTML;
}

// Format date for display
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else {
        return date.toLocaleDateString();
    }
}

// Show payment modal
function showPricing() {
    const modal = document.getElementById('paymentModal');
    modal.style.display = 'flex';
    
    // Check for selected package from sessionStorage
    const selectedPackageStr = sessionStorage.getItem('selectedPackage');
    if (selectedPackageStr) {
        try {
            const selectedPackage = JSON.parse(selectedPackageStr);
            const amountInput = document.getElementById('paymentAmount');
            const packageInfo = document.getElementById('selectedPackageInfo');
            const packageNameDisplay = document.getElementById('packageNameDisplay');
            
            if (amountInput && packageInfo && packageNameDisplay) {
                // Pre-fill amount
                amountInput.value = selectedPackage.amount;
                
                // Show package info
                packageNameDisplay.textContent = `${selectedPackage.name} Package - $${selectedPackage.amount} for ${selectedPackage.credits} SMS`;
                packageInfo.style.display = 'block';
                
                // Clear selected package after using it
                sessionStorage.removeItem('selectedPackage');
            }
        } catch (e) {
            console.error('Error parsing selected package:', e);
        }
    } else {
        // Hide package info if no package selected
        const packageInfo = document.getElementById('selectedPackageInfo');
        if (packageInfo) {
            packageInfo.style.display = 'none';
        }
    }
}

// Close payment modal
function closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Clear selected package info when modal is closed
    const packageInfo = document.getElementById('selectedPackageInfo');
    if (packageInfo) {
        packageInfo.style.display = 'none';
    }
    
    // Clear selected package from sessionStorage
    sessionStorage.removeItem('selectedPackage');
}

// Copy wallet address
function copyAddress(address) {
    if (!address) {
        console.error('No address provided to copyAddress');
        return;
    }
    
    navigator.clipboard.writeText(address).then(() => {
        // Find the button that was clicked (the one that called this function)
        const buttons = document.querySelectorAll('button[onclick*="copyAddress"]');
        buttons.forEach(btn => {
            if (btn.getAttribute('onclick').includes(address)) {
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                btn.style.color = '#00ff88';
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.style.color = '';
                }, 2000);
            }
        });
    }).catch(err => {
        console.error('Failed to copy address:', err);
        alert('Failed to copy address. Please copy manually.');
    });
}

// Submit payment
async function submitPayment(event) {
    event.preventDefault();

    const amount = document.getElementById('paymentAmount').value;
    const txid = document.getElementById('paymentTxid').value;
    const userEmail = sessionStorage.getItem('userEmail');
    const submitBtn = event.target.querySelector('button[type="submit"]');

    if (!userEmail) return;

    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;

    try {
        const response = await fetch('/api/submit-payment', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: userEmail,
                amount: amount,
                txid: txid
            })
        });

        const data = await response.json();

        if (data.success) {
            alert('Payment submitted successfully! Your credits will be added once approved.');
            closePaymentModal();
            event.target.reset();
            
            // Clear selected package info
            const packageInfo = document.getElementById('selectedPackageInfo');
            if (packageInfo) {
                packageInfo.style.display = 'none';
            }
            
            // Reload payment history to show new pending payment
            await loadPaymentHistory();
        } else {
            alert('Error submitting payment: ' + data.error);
        }
    } catch (error) {
        console.error('Payment submission error:', error);
        alert('Failed to submit payment. Please try again.');
    } finally {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
    }
}

// View history - Show payment history
function viewHistory() {
    // Scroll to payment history section
    const paymentHistorySection = document.querySelector('section:has(#paymentHistoryList)');
    if (paymentHistorySection) {
        paymentHistorySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Reload payment history
        loadPaymentHistory();
    }
}

// Load payment history
async function loadPaymentHistory() {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) return;

    const historyList = document.getElementById('paymentHistoryList');
    if (!historyList) return;

    try {
        const response = await fetch('/api/get-user-payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userEmail: userEmail })
        });

        const data = await response.json();

        if (data.success && data.payments && data.payments.length > 0) {
            const paymentsHTML = data.payments.map(payment => {
                const statusColor = payment.status === 'approved' ? '#28a745' : 
                                   payment.status === 'pending' ? '#ffc107' : '#dc3545';
                const statusText = payment.status.charAt(0).toUpperCase() + payment.status.slice(1);
                const date = new Date(payment.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                const credits = Math.floor(payment.amount); // $1 = 1 credit

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div style="flex: 1;">
                            <div style="font-weight: 600; margin-bottom: 0.25rem;">$${payment.amount} - ${credits} SMS</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">${date}</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted); font-family: monospace; margin-top: 0.25rem;">TXID: ${payment.txid ? payment.txid.substring(0, 12) + '...' : 'N/A'}</div>
                        </div>
                        <div style="text-align: right;">
                            <span style="background: rgba(${payment.status === 'approved' ? '40, 167, 69' : payment.status === 'pending' ? '255, 193, 7' : '220, 53, 69'}, 0.1); color: ${statusColor}; padding: 0.3rem 0.8rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600;">
                                ${statusText}
                            </span>
                            ${payment.approvedAt ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">Approved ${new Date(payment.approvedAt).toLocaleDateString()}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            historyList.innerHTML = paymentsHTML;
        } else {
            historyList.innerHTML = `
                <div style="text-align: center; color: var(--text-muted); padding: 2rem;">
                    <i class="fas fa-credit-card" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <p>No payment history found</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading payment history:', error);
        historyList.innerHTML = `
            <div style="text-align: center; color: #dc3545; padding: 2rem;">
                <p>Error loading payment history. Please try again.</p>
            </div>
        `;
    }
}

// Auto-refresh mechanism
let autoRefreshInterval = null;
let lastCreditsCount = 0;

function startAutoRefresh() {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) return;

    // Store initial credits count
    const initialCredits = parseInt(document.getElementById('creditsCount').textContent) || 0;
    lastCreditsCount = initialCredits;

    // Poll every 30 seconds
    autoRefreshInterval = setInterval(async () => {
        // Only refresh if modal is not open
        const modal = document.getElementById('paymentModal');
        if (modal && modal.style.display === 'flex') {
            return; // Don't refresh if payment modal is open
        }

        try {
            const userData = await getUserData(userEmail);
            if (userData) {
                const currentCredits = userData.smsCredits || 0;
                
                // Check if credits changed
                if (currentCredits !== lastCreditsCount) {
                    const creditsAdded = currentCredits - lastCreditsCount;
                    displayUserData(userData);
                    
                    // Show notification if credits increased
                    if (creditsAdded > 0) {
                        showNotification(`Payment approved! ${creditsAdded} SMS credit${creditsAdded > 1 ? 's' : ''} added to your account.`, 'success');
                    }
                    
                    lastCreditsCount = currentCredits;
                    
                    // Reload payment history to show updated status
                    await loadPaymentHistory();
                }
            }
        } catch (error) {
            console.error('Auto-refresh error:', error);
        }
    }, 30000); // 30 seconds
}

// Stop auto-refresh (cleanup)
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// Check for payment confirmations on load
async function checkPaymentConfirmations() {
    const userEmail = sessionStorage.getItem('userEmail');
    if (!userEmail) return;

    try {
        const response = await fetch('/api/get-user-payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userEmail: userEmail })
        });

        const data = await response.json();

        if (data.success && data.payments && data.payments.length > 0) {
            // Get last checked timestamp
            const lastChecked = sessionStorage.getItem('lastPaymentCheck') || '0';
            const lastCheckedTime = parseInt(lastChecked);

            // Find recently approved payments (within last 5 minutes)
            const recentApproved = data.payments.filter(payment => {
                if (payment.status !== 'approved' || !payment.approvedAt) return false;
                const approvedTime = new Date(payment.approvedAt).getTime();
                return approvedTime > lastCheckedTime && approvedTime > (Date.now() - 5 * 60 * 1000);
            });

            if (recentApproved.length > 0) {
                const totalCredits = recentApproved.reduce((sum, p) => sum + Math.floor(p.amount), 0);
                showNotification(`Payment approved! ${totalCredits} SMS credit${totalCredits > 1 ? 's' : ''} added to your account.`, 'success');
            }

            // Update last checked timestamp
            sessionStorage.setItem('lastPaymentCheck', Date.now().toString());
        }
    } catch (error) {
        console.error('Error checking payment confirmations:', error);
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Remove existing notification if any
    const existingNotification = document.getElementById('creditNotification');
    if (existingNotification) {
        existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.id = 'creditNotification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 3000;
        max-width: 400px;
        animation: slideIn 0.3s ease-out;
    `;
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}" style="font-size: 1.2rem;"></i>
            <div style="flex: 1;">${message}</div>
            <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; padding: 0; margin-left: 0.5rem;">&times;</button>
        </div>
    `;

    document.body.appendChild(notification);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Open main app
function openMainApp() {
    // In production, this would open the main Ticketmaster app
    // For now, we'll open the main app's index.html
    window.open('../public/index.html', '_blank');
}

// Contact support
function contactSupport() {
    alert('Support feature coming soon! This would open a support chat or contact form.');
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

// Close modal when clicking outside
document.addEventListener('click', function (e) {
    const modal = document.getElementById('paymentModal');
    if (e.target === modal) {
        closePaymentModal();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    stopAutoRefresh();
});

// Global functions for HTML onclick handlers
window.showPricing = showPricing;
window.closePaymentModal = closePaymentModal;
window.copyAddress = copyAddress;
window.submitPayment = submitPayment;
window.viewHistory = viewHistory;
window.openMainApp = openMainApp;
window.contactSupport = contactSupport;
window.logout = logout;
