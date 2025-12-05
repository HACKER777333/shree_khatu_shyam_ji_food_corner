// Payment Page JavaScript
let checkoutData = null;
let paymentCart = [];
let totalAmount = 0;
let discountAmount = 0;
let appliedCoupon = null;
let currentUpiUrl = '';
let paymentConfirmed = false;
let placeOrderInProgress = false;
let orderPlaced = false; // Flag to prevent cart empty alerts after order placement
const CHECKOUT_STORAGE_KEY = 'shophubCheckoutShipping';

document.addEventListener('DOMContentLoaded', () => {
    initializePaymentPage();
});

async function initializePaymentPage() {
    if (typeof isUserAuthenticated !== 'function' || !isUserAuthenticated()) {
        localStorage.setItem('returnAfterLogin', window.location.pathname);
        window.location.href = 'login.html';
        return;
    }

    checkoutData = loadCheckoutData();
    if (!checkoutData) {
        alert('Please complete checkout details first.');
        window.location.href = 'checkout.html';
        return;
    }

    // Load coupon data
    const couponData = sessionStorage.getItem('appliedCoupon');
    if (couponData) {
        try {
            const parsed = JSON.parse(couponData);
            appliedCoupon = parsed.code;
            discountAmount = parsed.discountAmount || 0;
        } catch (e) {
            console.warn('Error parsing coupon data', e);
        }
    }

    setSectionPlaceholders();

    await loadCartForPayment();
    if (!paymentCart.length) {
        alert('Your cart is empty.');
        window.location.href = 'cart.html';
        return;
    }

    renderShippingSummary();
    renderOrderSummary();
    await loadQRCode(totalAmount);

    document.getElementById('paymentConfirmedBtn').addEventListener('click', confirmPayment);
    document.getElementById('placeOrderBtn').addEventListener('click', placeOrder);
}

function loadCheckoutData() {
    const stored = sessionStorage.getItem(CHECKOUT_STORAGE_KEY);
    if (!stored) {
        return null;
    }
    try {
        return JSON.parse(stored);
    } catch (error) {
        console.warn('Unable to parse checkout data', error);
        sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
        return null;
    }
}

async function loadCartForPayment() {
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user || !user.email) {
        return;
    }

    // Setup Firestore real-time listener
    if (typeof setupCartListener === 'function') {
        setupCartListener(user.email, (updatedCart) => {
            // Only show alert if order hasn't been placed yet
            if (!orderPlaced) {
                console.log('[Payment Page] Cart updated from Firestore listener');
                paymentCart = updatedCart;
                renderOrderSummary();

                // Show warning if cart becomes empty (but not after order placement)
                if (!paymentCart.length) {
                    alert('Your cart has been emptied. Redirecting to cart page...');
                    window.location.href = 'cart.html';
                }
            } else {
                console.log('[Payment Page] Cart cleared after order placement - ignoring');
            }
        });
    }

    // Initial load from Firestore
    try {
        if (typeof loadCartFromFirestore === 'function') {
            paymentCart = await loadCartFromFirestore(user.email);
        } else {
            // Fallback to REST API
            const response = await fetch(`/api/cart/load?email=${encodeURIComponent(user.email)}`);
            if (!response.ok) throw new Error('Failed to load cart');
            const data = await response.json();
            paymentCart = Array.isArray(data.cart) ? data.cart : [];
        }
    } catch (error) {
        console.error('[Payment Page] Error loading cart:', error);
    }
}

function renderShippingSummary() {
    const summary = document.getElementById('shippingSummary');
    summary.innerHTML = `
        <p><strong>Name:</strong> ${checkoutData.customerName}</p>
        <p><strong>Email:</strong> ${checkoutData.customerEmail}</p>
        <p><strong>Phone:</strong> ${checkoutData.customerPhone}</p>
        <p><strong>Address:</strong> ${checkoutData.shippingAddress}, ${checkoutData.city}, ${checkoutData.state} - ${checkoutData.zipCode}</p>
    `;
}

function renderOrderSummary() {
    const summary = document.getElementById('paymentOrderSummary');
    if (!paymentCart.length) {
        summary.innerHTML = '<p>No items in cart.</p>';
        return;
    }

    const itemsHtml = paymentCart.map(item => `
        <div class="summary-item" style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid #eee;">
            <div>
                <strong>${item.name}</strong>
                <p style="margin:4px 0 0;">Qty: ${item.quantity}</p>
            </div>
            <div>₹${(item.price * item.quantity).toFixed(2)}</div>
        </div>
    `).join('');

    const cartTotal = paymentCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shippingFee = checkoutData.shippingFee || 0;
    const finalAmount = cartTotal - discountAmount + shippingFee;

    let discountHtml = '';
    if (discountAmount > 0) {
        discountHtml = `
            <div style="margin-top:10px; display:flex; justify-content:space-between; color:#28a745;">
                <span>Discount (${appliedCoupon}):</span>
                <span>-₹${discountAmount.toFixed(2)}</span>
            </div>
        `;
    }

    summary.innerHTML = `
        <div class="summary-items">${itemsHtml}</div>
        <div style="margin-top:20px; border-top: 2px solid #eee; padding-top: 10px;">
            
            ${discountHtml}
            <div style="display:flex; justify-content:space-between; margin-bottom: 5px;">
                <span>Delivery Fee:</span>
                <span>₹${shippingFee.toFixed(2)}</span>
            </div>
            <div style="margin-top:10px; font-weight:700; font-size: 1.1em; display:flex; justify-content:space-between;">
                <span>Total Amount:</span>
                <span>₹${finalAmount.toFixed(2)}</span>
            </div>
        </div>
    `;

    // Update global total for QR code and order placement
    totalAmount = finalAmount;
}

async function loadQRCode(amount) {
    const qrContainer = document.getElementById('qrCodeContainer');
    qrContainer.innerHTML = '<p>Loading QR Code...</p>';

    try {
        const response = await fetch(`/api/payment/qrcode?amount=${amount}`);
        const data = await response.json();
        if (data.qrCode) {
            currentUpiUrl = data.upiUrl || '';
            qrContainer.innerHTML = `
                <img src="${data.qrCode}" alt="UPI QR Code" class="qr-code-image">
                <p style="margin-top:10px;">UPI ID: <strong>${data.upiId}</strong></p>
                <button style="margin-top:10px; padding:10px 20px; border:none; border-radius:8px; background: var(--amazon-blue); color:#fff; cursor:pointer;" onclick="openPaymentApp()">Pay with UPI App</button>
            `;
        } else {
            qrContainer.innerHTML = '<p>Unable to load QR code. Please try again.</p>';
        }
    } catch (error) {
        console.error('Error loading QR code:', error);
        qrContainer.innerHTML = '<p>Unable to load QR code. Please try again.</p>';
    }
}

function openPaymentApp() {
    if (!currentUpiUrl) {
        alert('Unable to open payment app. Please scan the QR code.');
        return;
    }
    window.location.href = currentUpiUrl;
}

function confirmPayment() {
    paymentConfirmed = true;
    const confirmBtn = document.getElementById('paymentConfirmedBtn');
    const placeOrderBtn = document.getElementById('placeOrderBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'we check your payment if it is unpaid your order will be cancelled Make sure to do payment before placing order';
    placeOrderBtn.disabled = false;
}

async function placeOrder() {
    if (!paymentConfirmed) {
        alert('Please confirm payment before placing the order.');
        return;
    }
    if (!paymentCart.length) {
        alert('Your cart is empty.');
        return;
    }
    if (placeOrderInProgress) {
        return;
    }

    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    const orderData = {
        customer_name: checkoutData.customerName,
        customer_email: checkoutData.customerEmail,
        customer_phone: checkoutData.customerPhone,
        shipping_address: checkoutData.shippingAddress,
        city: checkoutData.city,
        state: checkoutData.state,
        zip_code: checkoutData.zipCode,
        items: paymentCart,
        total_amount: totalAmount,
        coupon_code: appliedCoupon,
        discount_amount: discountAmount,
        shipping_fee: checkoutData.shippingFee || 0,
        final_amount: totalAmount
    };

    const placeOrderBtn = document.getElementById('placeOrderBtn');
    if (placeOrderBtn) {
        placeOrderBtn.disabled = true;
    }
    placeOrderInProgress = true;
    showPaymentLoading('Sending your order to our team...');

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });

        const result = await response.json();
        if (result.success) {
            // Set flag to prevent cart empty alerts
            orderPlaced = true;

            // Clear cart from Firestore
            await clearCartOnServer(user.email);

            // Clear checkout data
            sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);

            // Show success animation and redirect to order tracking
            showPaymentLoading('Our team will shortly check your payment and confirm your order make sure to check your order status in the order tracking page and refresh it to get the updated status');
            setTimeout(() => {
                hidePaymentLoading();
                window.location.href = 'order-tracking.html';
            }, 10000);
        } else {
            alert('Unable to place order. Please try again.');
            hidePaymentLoading();
            if (placeOrderBtn) {
                placeOrderBtn.disabled = false;
            }
        }
    } catch (error) {
        console.error('Error placing order:', error);
        alert('Unable to place order. Please try again.');
        hidePaymentLoading();
        if (placeOrderBtn) {
            placeOrderBtn.disabled = false;
        }
    } finally {
        placeOrderInProgress = false;
    }
}

async function clearCartOnServer(email) {
    try {
        // Use Firestore client SDK to clear cart
        if (typeof clearCartFromFirestore === 'function') {
            await clearCartFromFirestore(email);
            console.log('[Payment Page] Cart cleared from Firestore');
        } else {
            // Fallback to REST API
            await fetch('/api/cart/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, cart: [] })
            });
        }
    } catch (error) {
        console.warn('[Payment Page] Unable to clear cart on server', error);
    }
}

function showPaymentLoading(message) {
    const modal = document.getElementById('paymentLoadingModal');
    const statusEl = document.getElementById('paymentLoadingStatus');
    if (statusEl && message) {
        statusEl.textContent = message;
    }
    if (modal) {
        modal.classList.add('show');
    }
}

function hidePaymentLoading() {
    const modal = document.getElementById('paymentLoadingModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function setSectionPlaceholders() {
    const shippingSummary = document.getElementById('shippingSummary');
    const orderSummary = document.getElementById('paymentOrderSummary');
    const qrContainer = document.getElementById('qrCodeContainer');

    if (shippingSummary) {
        shippingSummary.innerHTML = createPlaceholderBlock(4);
    }
    if (orderSummary) {
        orderSummary.innerHTML = createPlaceholderBlock(3);
    }
    if (qrContainer) {
        qrContainer.innerHTML = `
            <div class="loading-placeholder"></div>
            <div class="loading-placeholder"></div>
            <div class="loading-placeholder" style="width:60%; margin:10px auto;"></div>
        `;
    }
}

function createPlaceholderBlock(lines = 3) {
    return Array.from({ length: lines })
        .map(() => '<div class="loading-placeholder"></div>')
        .join('');
}
