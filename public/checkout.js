let checkoutCart = [];
const CHECKOUT_STORAGE_KEY = 'shophubCheckoutShipping';

// Restaurant Location (Fixed)
const RESTAURANT_LAT = 30.9432184;
const RESTAURANT_LNG = 75.8584566;

let shippingRatePerKm = 5.0; // Default, will be fetched from server
let currentShippingFee = 0;
let currentDistance = 0;

// Map Variables
let map;
let marker;
let appliedCoupon = null;
let discountAmount = 0;

document.addEventListener('DOMContentLoaded', () => {
    initializeCheckoutPage();
});

async function initializeCheckoutPage() {
    if (typeof isUserAuthenticated !== 'function' || !isUserAuthenticated()) {
        localStorage.setItem('returnAfterLogin', window.location.pathname);
        window.location.href = 'login.html';
        return;
    }

    // Fetch shipping rate first
    await fetchShippingRate();

    loadStoredShippingInfo();
    await loadCartForCheckout();

    const form = document.getElementById('checkoutForm');
    if (form) {
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            continueToPayment();
        });
    }

    // Initialize Map
    initMap();
}

async function fetchShippingRate() {
    try {
        const response = await fetch('/api/settings/shipping');
        const data = await response.json();
        if (data.rate !== undefined) {
            shippingRatePerKm = parseFloat(data.rate);
            console.log('Shipping rate loaded:', shippingRatePerKm);
        }
    } catch (error) {
        console.error('Error loading shipping rate:', error);
    }
}

function initMap() {
    const mapContainer = document.getElementById('mapContainer');
    const useLocationBtn = document.getElementById('useLocationBtn');

    if (!mapContainer) return;

    // Default to Restaurant center if no location
    const defaultLat = RESTAURANT_LAT;
    const defaultLng = RESTAURANT_LNG;

    if (useLocationBtn) {
        useLocationBtn.addEventListener('click', getCurrentLocation);
    }

    mapContainer.style.display = 'block';

    map = L.map('map').setView([defaultLat, defaultLng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Add restaurant marker
    L.marker([RESTAURANT_LAT, RESTAURANT_LNG]).addTo(map)
        .bindPopup("<b>Restaurant Location</b>").openPopup();

    // Click on map to set location
    map.on('click', function (e) {
        updateMarker(e.latlng.lat, e.latlng.lng);
    });

    setTimeout(() => {
        map.invalidateSize();
    }, 500);
}

function getCurrentLocation() {
    const useLocationBtn = document.getElementById('useLocationBtn');

    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }

    useLocationBtn.textContent = '⏳ Locating...';
    useLocationBtn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            updateMarker(lat, lng);
            map.setView([lat, lng], 16);

            useLocationBtn.textContent = '📍 Use Current Location';
            useLocationBtn.disabled = false;
        },
        (error) => {
            console.error('Error getting location:', error);
            alert('Unable to retrieve your location. Please check permissions.');
            useLocationBtn.textContent = '📍 Use Current Location';
            useLocationBtn.disabled = false;
        }
    );
}

function updateMarker(lat, lng) {
    if (marker) {
        marker.setLatLng([lat, lng]);
    } else {
        marker = L.marker([lat, lng], { draggable: true }).addTo(map);
        marker.on('dragend', function (event) {
            const position = marker.getLatLng();
            updateCoordinates(position.lat, position.lng);
        });
    }

    updateCoordinates(lat, lng);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c; // Distance in km
    return d;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function updateCoordinates(lat, lng) {
    document.getElementById('latitude').value = lat;
    document.getElementById('longitude').value = lng;

    // Create Google Maps Link
    const link = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    document.getElementById('googleMapsLink').value = link;

    // Calculate Distance and Shipping Fee
    const distance = calculateDistance(RESTAURANT_LAT, RESTAURANT_LNG, lat, lng);
    currentDistance = distance;
    currentShippingFee = Math.ceil(distance * shippingRatePerKm);

    // Minimum shipping fee (optional, e.g., ₹10)
    if (currentShippingFee < 10) currentShippingFee = 10;

    console.log(`Distance: ${distance.toFixed(2)} km, Fee: ₹${currentShippingFee}`);

    // Update UI
    renderCheckoutSummary();

    // Show confirm button when location is updated
    const confirmBtn = document.getElementById('confirmLocationBtn');
    if (confirmBtn) {
        confirmBtn.style.display = 'block';

        confirmBtn.onclick = function () {
            const linkDisplay = document.getElementById('locationLinkDisplay');
            const resultDiv = document.getElementById('locationResult');

            linkDisplay.textContent = link;
            linkDisplay.innerHTML = `<a href="${link}" target="_blank">${link}</a>`;
            resultDiv.style.display = 'block';

            document.getElementById('shippingAddress').value = `Map Location: ${lat}, ${lng}`;
        };
    }
}

function loadStoredShippingInfo() {
    const stored = sessionStorage.getItem(CHECKOUT_STORAGE_KEY);
    if (!stored) {
        const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
        if (user) {
            document.getElementById('customerName').value = user.name || '';
            document.getElementById('customerEmail').value = user.email || '';
            document.getElementById('customerPhone').value = user.phone || '';
        }
        return;
    }

    try {
        const data = JSON.parse(stored);
        document.getElementById('customerName').value = data.customerName || '';
        document.getElementById('customerEmail').value = data.customerEmail || '';
        document.getElementById('customerPhone').value = data.customerPhone || '';
        document.getElementById('shippingAddress').value = data.shippingAddress || '';
        document.getElementById('city').value = data.city || '';
        document.getElementById('state').value = data.state || '';
        document.getElementById('zipCode').value = data.zipCode || '';
    } catch (error) {
        console.warn('Unable to parse stored checkout info', error);
        sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
    }
}

async function loadCartForCheckout() {
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user || !user.email) {
        window.location.href = 'login.html';
        return;
    }

    // Setup Firestore real-time listener
    if (typeof setupCartListener === 'function') {
        setupCartListener(user.email, (updatedCart) => {
            console.log('[Checkout Page] Cart updated from Firestore listener');
            checkoutCart = updatedCart;
            renderCheckoutSummary();

            // Show warning if cart becomes empty
            if (!checkoutCart.length) {
                alert('Your cart has been emptied. Redirecting to cart page...');
                window.location.href = 'cart.html';
            }
        });
    }

    // Initial load from Firestore
    try {
        if (typeof loadCartFromFirestore === 'function') {
            checkoutCart = await loadCartFromFirestore(user.email);
        } else {
            // Fallback to REST API
            const response = await fetch(`/api/cart/load?email=${encodeURIComponent(user.email)}`);
            if (!response.ok) {
                throw new Error('Failed to load cart');
            }
            const data = await response.json();
            checkoutCart = Array.isArray(data.cart) ? data.cart : [];
        }
        renderCheckoutSummary();
    } catch (error) {
        console.error('[Checkout Page] Error loading cart:', error);
        showEmptyCheckout();
    }
}

function renderCheckoutSummary() {
    const itemsContainer = document.getElementById('checkoutItems');
    const subtotalEl = document.getElementById('checkoutSubtotal');
    const discountRow = document.getElementById('discountRow');
    const discountEl = document.getElementById('checkoutDiscount');
    const shippingEl = document.getElementById('checkoutShipping');
    const totalEl = document.getElementById('checkoutTotal');
    const emptyState = document.getElementById('emptyCheckoutState');
    const details = document.getElementById('checkoutSummaryDetails');

    if (!checkoutCart.length) {
        showEmptyCheckout();
        return;
    }

    itemsContainer.innerHTML = checkoutCart.map(item => `
        <div class="summary-item">
            <div>
                <strong>${item.name}</strong>
                <p style="margin:4px 0 0;">Qty: ${item.quantity}</p>
            </div>
            <div><p style="margin:4px 0 0;">₹${(item.price * item.quantity).toFixed(2)}</p></div>
        </div>
    `).join('');

    const subtotal = checkoutCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    subtotalEl.textContent = `₹${subtotal.toFixed(2)}`;

    // Update discount display
    if (discountAmount > 0) {
        discountRow.style.display = 'flex';
        discountEl.textContent = `-₹${discountAmount.toFixed(2)}`;
    } else {
        discountRow.style.display = 'none';
    }

    // Update Shipping
    if (currentShippingFee > 0) {
        shippingEl.innerHTML = `<b>₹${currentShippingFee.toFixed(2)}</b> <small>(${currentDistance.toFixed(1)} km)</small>`;
    } else {
        shippingEl.innerHTML = `<b>Calculated at Map Selection</b>`;
    }

    const total = subtotal - discountAmount + currentShippingFee;
    totalEl.textContent = `₹${total.toFixed(2)}`;

    emptyState.style.display = 'none';
    details.style.display = 'block';
}

async function applyCoupon() {
    const codeInput = document.getElementById('couponCode');
    const code = codeInput.value.trim().toUpperCase();
    const messageEl = document.getElementById('couponMessage');
    const applyBtn = document.getElementById('applyCouponBtn');

    if (!code) {
        messageEl.innerHTML = '<span style="color: #dc3545;">Please enter a coupon code</span>';
        return;
    }

    const subtotal = checkoutCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';
    messageEl.innerHTML = '';

    try {
        const response = await fetch('/api/coupons/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, cart_total: subtotal })
        });

        const result = await response.json();

        if (result.success && result.valid) {
            appliedCoupon = result.coupon;
            discountAmount = result.discount_amount;

            messageEl.innerHTML = `<span style="color: #28a745;">✓ Coupon applied! You saved ₹${discountAmount.toFixed(2)}</span>`;
            codeInput.disabled = true;
            applyBtn.textContent = 'Applied ✓';

            renderCheckoutSummary();
        } else {
            messageEl.innerHTML = `<span style="color: #dc3545;">✗ ${result.message || 'Invalid coupon code'}</span>`;
            applyBtn.disabled = false;
            applyBtn.textContent = 'Apply';
            appliedCoupon = null;
            discountAmount = 0;
            renderCheckoutSummary();
        }
    } catch (error) {
        console.error('Error applying coupon:', error);
        messageEl.innerHTML = '<span style="color: #dc3545;">Error applying coupon</span>';
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply';
    }
}

function showEmptyCheckout() {
    document.getElementById('emptyCheckoutState').style.display = 'block';
    document.getElementById('checkoutSummaryDetails').style.display = 'none';
    document.getElementById('continueToPaymentBtn').disabled = true;
}

function continueToPayment() {
    if (!checkoutCart.length) {
        alert('Your cart is empty. Please add items before continuing.');
        window.location.href = 'cart.html';
        return;
    }

    const shippingData = {
        customerName: document.getElementById('customerName').value.trim(),
        customerEmail: document.getElementById('customerEmail').value.trim(),
        customerPhone: document.getElementById('customerPhone').value.trim(),
        shippingAddress: '', // Will be set from map
        city: document.getElementById('city').value.trim(),
        state: document.getElementById('state').value.trim(),
        zipCode: document.getElementById('zipCode').value.trim(),
        googleMapsLink: document.getElementById('googleMapsLink').value.trim(),
        shippingFee: currentShippingFee,
        distance: currentDistance,
        savedAt: Date.now()
    };

    // Enforce Map Selection
    const googleMapsLink = document.getElementById('googleMapsLink').value.trim();
    if (!googleMapsLink) {
        alert('Please select and confirm your delivery location on the map.');
        return;
    }

    // Set shipping address from map link
    shippingData.shippingAddress = `Map Location: ${googleMapsLink}`;

    // Validation
    const requiredCommon = [shippingData.customerName, shippingData.customerEmail, shippingData.customerPhone];
    const isCommonValid = requiredCommon.every(field => field && field.trim() !== '');

    if (!isCommonValid) {
        alert('Please fill in your Name, Email, and Phone Number.');
        return;
    }

    sessionStorage.setItem(CHECKOUT_STORAGE_KEY, JSON.stringify(shippingData));

    // Save coupon data for payment page
    if (appliedCoupon) {
        sessionStorage.setItem('appliedCoupon', JSON.stringify({
            code: appliedCoupon.code,
            discountAmount: discountAmount
        }));
    } else {
        sessionStorage.removeItem('appliedCoupon');
    }

    window.location.href = 'payment.html';
}
