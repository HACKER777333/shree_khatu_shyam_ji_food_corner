
// Global state
let products = [];
let cart = [];
window.cart = cart; // Make cart globally accessible
let currentFilter = 'all';
let previewProduct = null;
let previewImageIndex = 0;
let currentUpiUrl = '';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Update auth UI (works for both authenticated and non-authenticated users)
    updateAuthUI();

    // Redirect to login if not authenticated (only for home page)
    // Redirect root or index.html to maal.html
    const currentPage = window.location.pathname;
    if (currentPage === '/' || currentPage.endsWith('/index.html')) {
        window.location.href = '/maal.html';
        return;
    }

    // Check if checkout parameter is in URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('checkout') === 'true') {
        // Hide cart sidebar and show checkout directly
        setTimeout(() => {
            if (cart.length > 0) {
                showCheckout();
            }
        }, 500);
    }

    // Only load products if we're on the products page - PRIORITY LOAD
    const productsGrid = document.getElementById('productsGrid');
    if (productsGrid) {
        console.log('Products page detected, loading products...');
        // Load products IMMEDIATELY - highest priority
        loadProducts();
    } else {
        console.log('Not on products page (productsGrid not found)');
    }

    // Load cart in parallel (non-blocking)
    loadCart();

    // Setup real-time cart sync
    setupCartSync();

    // Defer non-critical operations
    requestAnimationFrame(() => {
        attachPreviewModalHandlers();
        initScrollReveal();

        // Ensure cart is hidden on page load
        hideCart();

        // Load cart from server if user is logged in (non-blocking)
        if (typeof isUserAuthenticated === 'function' && isUserAuthenticated()) {
            loadCartFromServer();
        }

        // Update auth UI (non-blocking)
        updateAuthUI();
    });
});

// Update authentication UI
function updateAuthUI() {
    if (typeof isUserAuthenticated === 'function' && isUserAuthenticated()) {
        const user = getCurrentUser();
        if (user) {
            const userInfoEl = document.getElementById('userInfo');
            const logoutBtn = document.getElementById('logoutBtn');
            const loginLink = document.getElementById('loginLink');
            const signupLink = document.getElementById('signupLink');

            if (userInfoEl) {
                userInfoEl.textContent = `👤 ${user.name}`;
                userInfoEl.style.display = 'inline-block';
            }
            if (logoutBtn) logoutBtn.style.display = 'inline-block';
            if (loginLink) loginLink.style.display = 'none';
            if (signupLink) signupLink.style.display = 'none';
        }
    } else {
        const userInfoEl = document.getElementById('userInfo');
        const logoutBtn = document.getElementById('logoutBtn');
        const loginLink = document.getElementById('loginLink');
        const signupLink = document.getElementById('signupLink');

        if (userInfoEl) userInfoEl.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (loginLink) loginLink.style.display = 'inline-block';
        if (signupLink) signupLink.style.display = 'inline-block';
    }
}

// Load products from API
function normalizeProductData(product) {
    const imageList = Array.isArray(product.images)
        ? product.images.filter(img => typeof img === 'string' && img.trim() !== '')
        : [];

    // If no images in array but single image exists, add it
    if (imageList.length === 0 && product.image) {
        imageList.push(product.image);
    }

    // If still no images, try extra_images if it exists (from backend raw row)
    if (imageList.length === 0 && product.extra_images) {
        try {
            const extras = typeof product.extra_images === 'string' ? JSON.parse(product.extra_images) : product.extra_images;
            if (Array.isArray(extras)) {
                extras.forEach(img => {
                    if (typeof img === 'string' && img.trim() !== '') imageList.push(img);
                });
            }
        } catch (e) {
            console.warn('Failed to parse extra_images for product', product.id);
        }
    }

    product.images = imageList;
    product.primaryImage = imageList.length > 0 ? imageList[0] : (product.image || 'https://via.placeholder.com/400');
    // Ensure product.image is set for backward compatibility
    product.image = product.primaryImage;

    return product;
}

async function loadProducts() {
    const grid = document.getElementById('productsGrid');
    if (!grid) {
        console.warn('Products grid not found, cannot load products');
        return;
    }

    console.log('Loading products from API...');
    // Minimal loading state
    grid.innerHTML = '<div style="text-align: center; padding: 40px;"><p>Loading...</p></div>';

    try {
        // Direct fetch - no timeout wrapper for faster execution
        const response = await fetch('/api/products', {
            cache: 'no-cache',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const payload = await response.json();
        products = payload.map(normalizeProductData);
        console.log(`Loaded ${products.length} products`);

        if (products && products.length > 0) {
            // Display products IMMEDIATELY - synchronous rendering
            displayProducts(products);
            renderCategoryPills(products);
        } else {
            console.warn('No products returned from API');
            grid.innerHTML = '<div style="text-align: center; padding: 40px;"><p>No products available.</p></div>';
        }
    } catch (error) {
        console.error('Error loading products:', error);
        grid.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <p style="color: #dc3545; margin-bottom: 10px;">Error loading products</p>
                <button onclick="loadProducts()" style="margin-top: 15px; padding: 10px 20px; background: #ff9900; color: white; border: none; border-radius: 8px; cursor: pointer;">Retry</button>
            </div>
        `;
    }
}

// Render Category Pills Dynamically
function renderCategoryPills(productsList) {
    const pillsContainer = document.querySelector('.category-pills');
    if (!pillsContainer) return;

    // Extract unique categories
    const categories = new Set();
    productsList.forEach(p => {
        if (p.category) {
            categories.add(p.category);
        }
    });

    // Sort alphabetically
    const sortedCategories = Array.from(categories).sort();

    // Build HTML
    let html = `<button class="category-pill ${currentFilter === 'all' ? 'active' : ''}" onclick="showAllProducts()">All</button>`;

    sortedCategories.forEach(category => {
        const isActive = currentFilter === category ? 'active' : '';
        html += `<button class="category-pill ${isActive}" onclick="filterByCategory('${category.replace(/'/g, "\\'")}')">${category}</button>`;
    });

    pillsContainer.innerHTML = html;
}

// Filter by Category
function filterByCategory(category) {
    currentFilter = category;
    const filtered = products.filter(p => p.category === category);
    displayProducts(filtered);
    updateCategoryPills(category);

    // Update section title if it exists (though displayProducts now handles titles per section, 
    // when filtering we might want to show just that section or keep the categorized view)
    // For categorized view, filtering usually implies showing ONLY that category.
    // Let's update displayProducts to handle single category view gracefully if needed, 
    // or just let it render the single category section.
    const sectionTitle = document.querySelector('.section-title');
    if (sectionTitle) sectionTitle.textContent = category;
}

function showAllProducts() {
    currentFilter = 'all';
    displayProducts(products);
    updateCategoryPills('all');
    const sectionTitle = document.querySelector('.section-title');
    if (sectionTitle) sectionTitle.textContent = 'All Products';
}

function updateCategoryPills(activeCategory) {
    document.querySelectorAll('.category-pill').forEach(pill => {
        pill.classList.remove('active');
        if (pill.textContent === activeCategory || (activeCategory === 'all' && pill.textContent === 'All')) {
            pill.classList.add('active');
        }
    });
}

// Display products - Sorted Grid (Amazon Style)
function displayProducts(productsToShow) {
    const grid = document.getElementById('productsGrid');
    if (!grid) return;

    if (!productsToShow || productsToShow.length === 0) {
        grid.innerHTML = '<div style="text-align: center; padding: 40px;"><p>No products found.</p></div>';
        return;
    }

    // Sort products by category (alphabetical)
    const sortedProducts = [...productsToShow].sort((a, b) => {
        const catA = (a.category || '').toLowerCase();
        const catB = (b.category || '').toLowerCase();
        if (catA < catB) return -1;
        if (catA > catB) return 1;
        return 0;
    });

    // Build HTML string
    let html = '';
    sortedProducts.forEach(product => {
        const card = createProductCard(product);
        html += card.outerHTML;
    });

    // Single DOM update
    grid.innerHTML = html;

    // Attach event listeners after rendering
    sortedProducts.forEach(product => {
        const card = document.getElementById(`product-card-${product.id}`);
        if (card) {
            const imageEl = card.querySelector('.product-image');
            const nameEl = card.querySelector('.product-name');
            if (imageEl) {
                imageEl.addEventListener('click', () => openProductPreview(product.id));
            }
            if (nameEl) {
                nameEl.addEventListener('click', () => openProductPreview(product.id));
            }
        }
    });
}

// Create product card
function createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';

    // Robust availability check
    const isAvailable = product.is_available !== false && product.is_available !== 0;

    if (!isAvailable) {
        card.classList.add('unavailable');
    }
    card.id = `product-card-${product.id}`;
    const imageSrc = product.primaryImage || product.image || 'https://via.placeholder.com/300';

    // Check if product is in cart
    const cartItem = cart.find(item => item.id === product.id);
    const quantity = cartItem ? cartItem.quantity : 0;

    const rating = product.rating || 0;
    const reviews = product.reviews || 0;
    const stars = '★'.repeat(Math.floor(rating)) + '☆'.repeat(5 - Math.floor(rating));

    let actionButtonHtml = '';
    if (!isAvailable) {
        actionButtonHtml = `<button class="add-to-cart-btn disabled" disabled style="background-color: #ccc; cursor: not-allowed;">Unavailable</button>`;
    } else if (quantity > 0) {
        actionButtonHtml = `
            <div class="product-quantity-controls">
                <button class="quantity-btn-small" onclick="updateProductQuantity(${product.id}, -1)">-</button>
                <span class="product-quantity-display">${quantity} in cart</span>
                <button class="quantity-btn-small" onclick="updateProductQuantity(${product.id}, 1)">+</button>
                <button class="delete-btn-small" onclick="deleteFromCart(${product.id})" title="Remove from cart">🗑️</button>
            </div>
        `;
    } else {
        actionButtonHtml = `<button class="add-to-cart-btn" onclick="addToCart(${product.id})">Add to Cart</button>`;
    }

    card.innerHTML = `
        <div class="product-image-container">
            <img src="${imageSrc}" alt="${product.name}" class="product-image" onerror="this.src='https://via.placeholder.com/300'">
            ${!isAvailable
            ? '<span class="unavailable-badge">UNAVAILABLE</span>'
            : '<span class="available-badge">AVAILABLE</span>'}
        </div>
        <h3 class="product-name">${product.name}</h3>
        <div class="product-rating">
            <span class="stars">${stars}</span>
            <span class="reviews">(${reviews})</span>
        </div>
        <div class="product-price">${product.price.toFixed(2)}</div>
        <div class="product-status-text" style="font-size: 12px; margin-bottom: 8px; font-weight: 600; color: ${isAvailable ? '#2e7d32' : '#d32f2f'};">
            Status: ${isAvailable ? 'In Stock' : 'Out of Stock'}
        </div>
        <div class="product-cart-controls" id="cart-controls-${product.id}">
            ${actionButtonHtml}
        </div>
    `;
    const imageEl = card.querySelector('.product-image');
    if (imageEl) {
        imageEl.addEventListener('click', () => openProductPreview(product.id));
    }
    const nameEl = card.querySelector('.product-name');
    if (nameEl) {
        nameEl.addEventListener('click', () => openProductPreview(product.id));
    }
    return card;
}

// Update product card quantity controls
function updateProductCardControls(productId) {
    const cartItem = cart.find(item => item.id === productId);
    const quantity = cartItem ? cartItem.quantity : 0;
    const controlsDiv = document.getElementById(`cart-controls-${productId}`);

    if (!controlsDiv) return;

    if (quantity > 0) {
        controlsDiv.innerHTML = `
            <div class="product-quantity-controls">
                <button class="quantity-btn-small" onclick="updateProductQuantity(${productId}, -1)">-</button>
                <span class="product-quantity-display">${quantity} in cart</span>
                <button class="quantity-btn-small" onclick="updateProductQuantity(${productId}, 1)">+</button>
                <button class="delete-btn-small" onclick="deleteFromCart(${productId})" title="Remove from cart">🗑️</button>
            </div>
        `;
    } else {
        controlsDiv.innerHTML = `
            <button class="add-to-cart-btn" onclick="addToCart(${productId})">Add to Bag</button>
        `;
    }
}

// Add to cart
function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) {
        showNotification('Product not found!', 'error');
        return;
    }

    if (product.is_available === false || product.is_available === 0) {
        showNotification('This product is currently unavailable.', 'error');
        return;
    }

    const existingItem = cart.find(item => item.id === productId);
    if (existingItem) {
        existingItem.quantity++;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.primaryImage || product.image,
            quantity: 1
        });
    }

    // Update global cart reference
    if (typeof window !== 'undefined') {
        window.cart = cart;
    }

    console.log('Item added to cart:', product.name, 'Cart now has', cart.length, 'items:', cart);

    saveCart();
    updateCartUI();
    updateProductCardControls(productId);

    // Show notification
    if (typeof showNotification === 'function') {
        showNotification(`${product.name} added to cart!`);
    }

    // Update cart UI
    updateCartUI();
}

// Remove from cart
function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    window.cart = cart; // Update global reference
    saveCart();
    updateCartUI();
    updateProductCardControls(productId);
}

// Delete from cart (with notification)
function deleteFromCart(productId) {
    const product = products.find(p => p.id === productId);
    const productName = product ? product.name : 'Item';

    cart = cart.filter(item => item.id !== productId);
    window.cart = cart; // Update global reference
    saveCart();
    updateCartUI();
    updateProductCardControls(productId);
    showNotification(`${productName} removed from cart!`);
}

// Update quantity (for cart sidebar and cart page)
function updateQuantity(productId, change) {
    const item = cart.find(item => item.id === productId);
    if (!item) return;

    item.quantity += change;
    if (item.quantity <= 0) {
        removeFromCart(productId);
    } else {
        window.cart = cart; // Update global reference
        saveCart();
        updateCartUI();
    }
    if (typeof updateProductCardControls === 'function') {
        updateProductCardControls(productId);
    }
}

// Update product quantity (for product card controls)
function updateProductQuantity(productId, change) {
    const product = products.find(p => p.id === productId);
    if (!product) {
        showNotification('Product not found!', 'error');
        return;
    }

    const existingItem = cart.find(item => item.id === productId);

    if (existingItem) {
        existingItem.quantity += change;
        if (existingItem.quantity <= 0) {
            removeFromCart(productId);
        } else {
            saveCart();
            updateCartUI();
            updateProductCardControls(productId);
        }
    } else if (change > 0) {
        // If item not in cart and trying to add
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.primaryImage || product.image,
            quantity: 1
        });
        window.cart = cart; // Update global reference
        saveCart();
        updateCartUI();
        updateProductCardControls(productId);
    }
}

// Setup real-time cart sync
function setupCartSync() {
    // Listen for custom cart update events (dispatched after saveCart)
    window.addEventListener('cartUpdated', () => {
        updateCartUI();
        if (typeof updateAllProductCards === 'function') {
            updateAllProductCards();
        }
    });

    // Listen for localStorage changes (cross-tab sync for guests)
    window.addEventListener('storage', (e) => {
        if (e.key === 'guestCart') {
            // Only reload if we are a guest
            if (typeof isUserAuthenticated === 'function' && !isUserAuthenticated()) {
                console.log('Guest cart updated in another tab');
                loadCart();
            }
        }
    });
}

// Save cart
function saveCart() {
    window.cart = cart; // Keep global reference in sync

    // If user is logged in, sync with server via API
    if (typeof isUserAuthenticated === 'function' && isUserAuthenticated()) {
        const user = getCurrentUser();
        if (user && user.email) {
            fetch('/api/cart/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: user.email,
                    cart: cart
                })
            }).then(() => {
                window.dispatchEvent(new CustomEvent('cartUpdated'));
            }).catch(error => {
                console.error('Error syncing cart to server:', error);
            });
        }
    } else {
        // Guest user: save to localStorage
        localStorage.setItem('guestCart', JSON.stringify(cart));
        window.dispatchEvent(new CustomEvent('cartUpdated'));
    }
}

// Load cart
function loadCart() {
    // If user is logged in, load from server
    if (typeof isUserAuthenticated === 'function' && isUserAuthenticated()) {
        loadCartFromServer();
        return;
    }

    // Guest users: load from localStorage
    const savedCart = localStorage.getItem('guestCart');
    if (savedCart) {
        try {
            cart = JSON.parse(savedCart);
        } catch (e) {
            console.error('Error parsing guest cart:', e);
            cart = [];
        }
    } else {
        cart = [];
    }

    if (!Array.isArray(cart)) {
        cart = [];
    }

    window.cart = cart;
    updateCartUI();
    if (typeof updateAllProductCards === 'function') {
        updateAllProductCards();
    }
}

// Load cart from server
async function loadCartFromServer() {
    if (typeof isUserAuthenticated !== 'function' || !isUserAuthenticated()) {
        return;
    }

    const user = getCurrentUser();
    if (!user || !user.email) return;

    try {
        const response = await fetch(`/api/cart/load?email=${encodeURIComponent(user.email)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.cart) {
                cart = data.cart;
                window.cart = cart;
                updateCartUI();
                if (typeof updateAllProductCards === 'function') {
                    updateAllProductCards();
                }
                console.log('Cart loaded from server');
            }
        }
    } catch (error) {
        console.error('[Products Page] Error loading cart:', error);
    }
}

// Update all product cards to reflect current cart state
function updateAllProductCards() {
    products.forEach(product => {
        updateProductCardControls(product.id);
    });
}

// Update cart UI
function updateCartUI() {
    // Ensure cart and window.cart are in sync
    if (typeof window !== 'undefined') {
        if (!window.cart || window.cart !== cart) {
            window.cart = cart;
        }
    }

    // Cart sidebar is always available, no need for separate page handling

    const cartCount = document.getElementById('cartCount');
    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');
    const checkoutBtn = document.getElementById('checkoutBtn');
    const cartInlineAction = document.getElementById('cartInlineAction');

    // Update cart count (if element exists)
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (cartCount) {
        cartCount.textContent = totalItems;
        // Show badge only if there are items in cart
        cartCount.style.display = totalItems > 0 ? 'flex' : 'none';
    }

    // Update cart items
    if (cart.length === 0) {
        if (cartItems) {
            cartItems.innerHTML = '<p class="empty-cart">Your cart is empty</p>';
        }
        if (checkoutBtn) {
            checkoutBtn.disabled = true;
            checkoutBtn.style.display = 'block'; // Always show button
            checkoutBtn.style.visibility = 'visible';
            checkoutBtn.style.opacity = '0.6';
        }
    } else {
        if (cartItems) {
            cartItems.innerHTML = cart.map(item => `
                <div class="cart-item">
                    <img src="${item.image || 'https://via.placeholder.com/80'}" alt="${item.name}" class="cart-item-image" onerror="this.src='https://via.placeholder.com/80'">
                    <div class="cart-item-details">
                        <div class="cart-item-name">${item.name}</div>
                        <div class="cart-item-price">${item.price.toFixed(2)}</div>
                        <div class="cart-item-quantity">
                            <button class="quantity-btn" onclick="updateQuantity(${item.id}, -1)">-</button>
                            <span>${item.quantity}</span>
                            <button class="quantity-btn" onclick="updateQuantity(${item.id}, 1)">+</button>
                        </div>
                        <button class="remove-item-btn" onclick="removeFromCart(${item.id})">Remove</button>
                    </div>
                </div>
            `).join('');
        }
        if (checkoutBtn) {
            checkoutBtn.disabled = false;
            checkoutBtn.style.display = 'block'; // Always show button
            checkoutBtn.style.visibility = 'visible';
            checkoutBtn.style.opacity = '1';
        }
    }

    // Update total
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    if (cartTotal) {
        cartTotal.textContent = `${total.toFixed(2)}`;
    }

    if (cartInlineAction) {
        cartInlineAction.style.display = cart.length ? 'flex' : 'none';
    }
}

// Show cart - only opens when explicitly called
function showCart() {
    const cartSidebar = document.getElementById('cartSidebar');
    const cartOverlay = document.getElementById('cartOverlay');

    if (cartSidebar && cartOverlay) {
        cartSidebar.classList.add('open');
        cartOverlay.classList.add('show');
        // Prevent body scroll when cart is open
        document.body.style.overflow = 'hidden';
    }
}

// Hide cart - ensures cart is always hidden unless explicitly opened
function hideCart() {
    const cartSidebar = document.getElementById('cartSidebar');
    const cartOverlay = document.getElementById('cartOverlay');

    if (cartSidebar && cartOverlay) {
        cartSidebar.classList.remove('open');
        cartOverlay.classList.remove('show');
        // Restore body scroll when cart is closed
        document.body.style.overflow = '';
    }
}

// Show checkout
function showCheckout() {
    if (cart.length === 0) {
        showNotification('Your cart is empty!', 'error');
        return;
    }

    if (typeof isUserAuthenticated === 'function' && !isUserAuthenticated()) {
        if (confirm('Please login to continue with checkout. Would you like to login now?')) {
            const currentPath = window.location.pathname || '/maal.html';
            localStorage.setItem('returnAfterLogin', currentPath);
            window.location.href = '/login.html';
        }
        return;
    }

    window.location.href = '/checkout.html';
}

// Load QR Code
async function loadQRCode(amount) {
    const qrContainer = document.getElementById('qrCodeContainer');
    qrContainer.innerHTML = '<p>Loading QR Code...</p>';

    try {
        currentUpiUrl = '';
        const response = await fetch(`/api/payment/qrcode?amount=${amount}`);
        const data = await response.json();

        if (data.qrCode) {
            qrContainer.innerHTML = `
                <img src="${data.qrCode}" alt="UPI QR Code" class="qr-code-image">
                <p class="upi-details">UPI ID: <strong>${data.upiId}</strong></p>
            `;
            currentUpiUrl = data.upiUrl || '';
        } else {
            qrContainer.innerHTML = '<p>Error loading QR code. Please try again.</p>';
        }
    } catch (error) {
        console.error('Error loading QR code:', error);
        qrContainer.innerHTML = '<p>Error loading QR code. Please try again.</p>';
    }
}

// Open native UPI app with pre-filled amount
function openPaymentApp() {
    const amountEl = document.getElementById('paymentAmount');
    const rawAmount = amountEl ? amountEl.textContent || amountEl.innerText || '0' : '0';
    const amount = parseFloat(rawAmount) || 0;

    let upiUrl = currentUpiUrl;
    const upiId = 'priyankjain2047@fam';

    if (!upiUrl && amount > 0) {
        upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&am=${amount}&cu=INR&tn=${encodeURIComponent('Order Payment')}`;
    }

    if (!upiUrl) {
        alert('Unable to open payment app. Please scan the QR code instead.');
        return;
    }

    window.location.href = upiUrl;
}

// Confirm payment
function confirmPayment() {
    const btn = document.getElementById('paymentConfirmedBtn');
    const placeOrderBtn = document.getElementById('placeOrderBtn');

    // Disable the payment button and show confirmation
    btn.disabled = true;
    btn.textContent = '✓ Payment Confirmed';
    btn.style.backgroundColor = '#28a745';

    // Enable place order button
    placeOrderBtn.disabled = false;
    placeOrderBtn.style.display = 'block';

    // Scroll to order button
    placeOrderBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Hide checkout
function hideCheckout() {
    document.getElementById('checkoutModal').classList.remove('show');
    document.getElementById('checkoutOverlay').classList.remove('show');
}

// Show loading modal
function showLoadingModal() {
    const loadingModal = document.getElementById('loadingModal');
    if (loadingModal) {
        loadingModal.classList.add('show');
    }
}

// Hide loading modal
function hideLoadingModal() {
    const loadingModal = document.getElementById('loadingModal');
    if (loadingModal) {
        loadingModal.classList.remove('show');
    }
}

// Place order
async function placeOrder(event) {
    event.preventDefault();

    // Check if user is authenticated
    if (typeof isUserAuthenticated === 'function' && !isUserAuthenticated()) {
        alert('Please login to place an order');
        window.location.href = 'login.html';
        return;
    }

    // Get current user info
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user) {
        alert('Please login to place an order');
        window.location.href = 'login.html';
        return;
    }

    // Check if payment is confirmed
    const placeOrderBtn = document.getElementById('placeOrderBtn');

    if (placeOrderBtn.disabled || placeOrderBtn.style.display === 'none') {
        alert('Please confirm your payment first by clicking "I Have Paid" button.');
        return;
    }

    // Final warning confirmation before placing order
    const finalWarning = confirm(
        '⚠️ FINAL CONFIRMATION\n\n' +
        'Have you completed the payment?\n\n' +
        'IMPORTANT: If you place this order without making the payment, your order will be automatically CANCELLED.\n\n' +
        'Click OK only if you have already made the payment.\n' +
        'Click Cancel if you have not paid yet.'
    );

    if (!finalWarning) {
        return; // User cancelled, don't place order
    }

    // Show loading modal immediately
    showLoadingModal();

    // Disable the place order button to prevent multiple clicks
    if (placeOrderBtn) {
        placeOrderBtn.disabled = true;
    }

    const orderData = {
        customer_name: user.name || document.getElementById('customerName').value,
        customer_email: user.email || document.getElementById('customerEmail').value,
        customer_phone: user.phone || document.getElementById('customerPhone').value,
        shipping_address: document.getElementById('shippingAddress').value,
        city: document.getElementById('city').value,
        state: document.getElementById('state').value,
        zip_code: document.getElementById('zipCode').value,
        items: cart,
        total_amount: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    };

    try {
        const response = await fetch('/api/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(orderData)
        });

        const result = await response.json();

        // Hide loading modal
        hideLoadingModal();

        if (result.success) {
            // Clear cart
            cart = [];
            saveCart();
            updateCartUI();

            // Show success modal
            const orderNumber = result.order.order_number;
            document.getElementById('orderNumber').textContent = orderNumber;
            const trackLink = document.getElementById('trackOrderLink');
            if (trackLink) {
                trackLink.href = `order-tracking.html?order=${encodeURIComponent(orderNumber)}`;
            }
            document.getElementById('successModal').classList.add('show');
            hideCheckout();

            // Reset form and payment state
            document.getElementById('checkoutForm').reset();
            document.getElementById('paymentConfirmedBtn').disabled = false;
            document.getElementById('paymentConfirmedBtn').textContent = '✓ I Have Paid';
            document.getElementById('paymentConfirmedBtn').style.backgroundColor = '#ff9900';
            document.getElementById('placeOrderBtn').disabled = true;
            document.getElementById('placeOrderBtn').style.display = 'none';
            closeProductPreview();
        } else {
            alert('Error placing order. Please try again.');
            // Re-enable button on error
            if (placeOrderBtn) {
                placeOrderBtn.disabled = false;
            }
        }
    } catch (error) {
        console.error('Error placing order:', error);
        // Hide loading modal on error
        hideLoadingModal();
        alert('Error placing order. Please try again.');
        // Re-enable button on error
        if (placeOrderBtn) {
            placeOrderBtn.disabled = false;
        }
    }
}

// Close success modal
function closeSuccessModal() {
    document.getElementById('successModal').classList.remove('show');
    // Stay on current page (products page) to continue shopping
}

// Search products
function searchProducts() {
    // Try to get search input from either header or page search bar
    const searchInput = document.getElementById('headerSearchInput') || document.getElementById('searchInput');
    if (!searchInput) return;

    const searchTerm = searchInput.value.toLowerCase().trim();

    if (searchTerm === '') {
        // If search is empty, show all products
        showAllProducts();
        return;
    }

    const filtered = products.filter(product =>
        product.name.toLowerCase().includes(searchTerm) ||
        (product.description && product.description.toLowerCase().includes(searchTerm))
    );
    displayProducts(filtered);

    // Update section title to show search results
    const sectionTitle = document.querySelector('#productsSection .section-title');
    if (sectionTitle) {
        if (filtered.length > 0) {
            sectionTitle.textContent = `Search Results (${filtered.length} found)`;
        } else {
            sectionTitle.textContent = 'No products found';
        }
    }

    // Sync search input if both exist
    const headerInput = document.getElementById('headerSearchInput');
    const pageInput = document.getElementById('searchInput');
    if (headerInput && pageInput) {
        if (searchInput === headerInput) {
            pageInput.value = headerInput.value;
        } else {
            headerInput.value = pageInput.value;
        }
    }
}

// Clear search
function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const headerInput = document.getElementById('headerSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    if (headerInput) {
        headerInput.value = '';
    }
    showAllProducts();
    const sectionTitle = document.querySelector('#productsSection .section-title');
    if (sectionTitle) {
        sectionTitle.textContent = 'All Products';
    }
}

// Filter by category
function filterByCategory(category) {
    currentFilter = category;

    // Clear search when filtering by category
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
    }

    const filtered = category === 'all'
        ? products
        : products.filter(p => p.category === category);
    displayProducts(filtered);

    // Update section title
    const sectionTitle = document.querySelector('#productsSection .section-title');
    if (sectionTitle) {
        if (category === 'all') {
            sectionTitle.textContent = 'All Products';
        } else {
            sectionTitle.textContent = `${category} (${filtered.length} products)`;
        }
    }
}

// Show all products
function showAllProducts() {
    currentFilter = 'all';

    // Clear search inputs
    const searchInput = document.getElementById('searchInput');
    const headerInput = document.getElementById('headerSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    if (headerInput) {
        headerInput.value = '';
    }

    displayProducts(products);

    // Update section title
    const sectionTitle = document.querySelector('#productsSection .section-title');
    if (sectionTitle) {
        sectionTitle.textContent = 'All Products';
    }

    // Only scroll if we're on the home page (which shouldn't happen now, but just in case)
    const productsSection = document.getElementById('productsSection');
    if (productsSection) {
        productsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Scroll to products section
function scrollToProducts() {
    // Redirect to products page (maal.html)
    window.location.href = '/maal.html';
}

// Go back function
function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = '/home';
    }
}

// User logout function
function userLogout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('userAuth');
        window.location.href = 'login.html';
    }
}

// Show notification
function showNotification(message, type = 'success') {
    // Simple notification (you can enhance this)
    const notification = document.createElement('div');
    const bgColor = type === 'error' ? '#dc3545' : '#28a745';
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        background: ${bgColor};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s;
        font-weight: 500;
        max-width: 300px;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

/* ===========================
   Product Preview Modal
=========================== */

function attachPreviewModalHandlers() {
    const overlay = document.getElementById('productPreviewOverlay');
    const closeBtn = document.getElementById('productPreviewClose');
    const prevBtn = document.getElementById('productPreviewPrev');
    const nextBtn = document.getElementById('productPreviewNext');
    const addBtn = document.getElementById('productPreviewAddBtn');

    if (overlay) {
        overlay.addEventListener('click', closeProductPreview);
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', closeProductPreview);
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', () => changePreviewImage(-1));
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => changePreviewImage(1));
    }
    if (addBtn) {
        addBtn.addEventListener('click', addPreviewProductToCart);
    }

    document.addEventListener('keydown', (event) => {
        const modal = document.getElementById('productPreviewModal');
        if (!modal || !modal.classList.contains('show')) return;
        if (event.key === 'Escape') {
            closeProductPreview();
        } else if (event.key === 'ArrowRight') {
            changePreviewImage(1);
        } else if (event.key === 'ArrowLeft') {
            changePreviewImage(-1);
        }
    });
}

function openProductPreview(productId) {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    previewProduct = product;
    previewImageIndex = 0;

    const modal = document.getElementById('productPreviewModal');
    const overlay = document.getElementById('productPreviewOverlay');
    const modalImage = document.getElementById('productPreviewImage');
    const modalTitle = document.getElementById('productPreviewTitle');
    const modalPrice = document.getElementById('productPreviewPrice');
    const modalDesc = document.getElementById('productPreviewDescription');
    const modalRating = document.getElementById('productPreviewRating');
    const modalReviews = document.getElementById('productPreviewReviews');
    const indicators = document.getElementById('productPreviewIndicators');
    const addBtn = document.getElementById('productPreviewAddBtn');

    if (!modal || !overlay) return;

    // Populate data
    modalTitle.textContent = product.name;
    modalPrice.textContent = `₹${product.price.toFixed(2)}`;
    modalDesc.textContent = product.description || 'No description available.';
    modalRating.textContent = `${product.rating || 0} ★`;
    modalReviews.textContent = `(${product.reviews || 0} reviews)`;

    // Setup images
    updatePreviewImage();

    // Setup indicators
    if (indicators) {
        indicators.innerHTML = '';
        if (product.images && product.images.length > 1) {
            product.images.forEach((_, idx) => {
                const dot = document.createElement('div');
                dot.className = `indicator-dot ${idx === 0 ? 'active' : ''}`;
                dot.addEventListener('click', () => {
                    previewImageIndex = idx;
                    updatePreviewImage();
                });
                indicators.appendChild(dot);
            });
        }
    }

    // Availability check for modal button
    const isAvailable = product.is_available !== false && product.is_available !== 0;
    if (addBtn) {
        if (!isAvailable) {
            addBtn.disabled = true;
            addBtn.textContent = 'Unavailable';
            addBtn.style.backgroundColor = '#ccc';
            addBtn.style.cursor = 'not-allowed';
        } else {
            addBtn.disabled = false;
            addBtn.textContent = 'Add to Cart';
            addBtn.style.backgroundColor = ''; // Reset to default CSS
            addBtn.style.cursor = 'pointer';
        }
    }

    // Show modal
    modal.classList.add('show');
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
}

function closeProductPreview() {
    const modal = document.getElementById('productPreviewModal');
    const overlay = document.getElementById('productPreviewOverlay');

    if (modal) modal.classList.remove('show');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
    previewProduct = null;
}

function changePreviewImage(direction) {
    if (!previewProduct || !previewProduct.images || previewProduct.images.length <= 1) return;

    previewImageIndex += direction;
    if (previewImageIndex < 0) {
        previewImageIndex = previewProduct.images.length - 1;
    } else if (previewImageIndex >= previewProduct.images.length) {
        previewImageIndex = 0;
    }

    updatePreviewImage();
}

function updatePreviewImage() {
    const modalImage = document.getElementById('productPreviewImage');
    const indicators = document.getElementById('productPreviewIndicators');

    if (modalImage && previewProduct) {
        const imgSrc = previewProduct.images[previewImageIndex] || previewProduct.image || 'https://via.placeholder.com/400';
        modalImage.src = imgSrc;
    }

    if (indicators) {
        const dots = indicators.querySelectorAll('.indicator-dot');
        dots.forEach((dot, idx) => {
            if (idx === previewImageIndex) dot.classList.add('active');
            else dot.classList.remove('active');
        });
    }
}

function addPreviewProductToCart() {
    if (previewProduct) {
        addToCart(previewProduct.id);
        closeProductPreview();
    }
}

// Scroll Reveal Animation
function initScrollReveal() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    const elements = document.querySelectorAll('.product-card, .section-title, .hero-text');
    elements.forEach(el => {
        el.classList.add('scroll-reveal');
        observer.observe(el);
    });
}
