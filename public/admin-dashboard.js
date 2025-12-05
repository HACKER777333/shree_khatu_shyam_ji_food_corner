// Admin Dashboard functionality

let allOrders = [];
let filteredOrders = [];
let productsList = [];
let editingProductId = null;

// Go back function
function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = '/home';
    }
}

// Show main dashboard (navigation buttons)
function showMainDashboard() {
    document.getElementById('main-dashboard').style.display = 'block';
    document.getElementById('products-section').style.display = 'none';
    document.getElementById('orders-section').style.display = 'none';
    document.getElementById('filters-section').style.display = 'none';
    document.getElementById('stats-section').style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show products management section
function showProductsManagement() {
    document.getElementById('main-dashboard').style.display = 'none';
    document.getElementById('products-section').style.display = 'block';
    document.getElementById('orders-section').style.display = 'none';
    document.getElementById('filters-section').style.display = 'none';
    document.getElementById('stats-section').style.display = 'none';
    // Load products if not already loaded
    if (productsList.length === 0) {
        loadProducts();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show orders management section
function showOrdersManagement() {
    document.getElementById('main-dashboard').style.display = 'none';
    document.getElementById('products-section').style.display = 'none';
    document.getElementById('orders-section').style.display = 'block';
    document.getElementById('filters-section').style.display = 'block';
    document.getElementById('stats-section').style.display = 'block';
    document.getElementById('settings-section').style.display = 'none';
    // Load orders if not already loaded
    if (allOrders.length === 0) {
        loadOrders();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show settings management section
function showSettingsManagement() {
    document.getElementById('main-dashboard').style.display = 'none';
    document.getElementById('products-section').style.display = 'none';
    document.getElementById('orders-section').style.display = 'none';
    document.getElementById('filters-section').style.display = 'none';
    document.getElementById('stats-section').style.display = 'none';
    document.getElementById('settings-section').style.display = 'block';

    loadShippingSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Show coupons management page
function showCouponsManagement() {
    window.location.href = 'admin-coupons.html';
}

// Admin logout function
function adminLogout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('adminAuth');
        window.location.href = 'login.html';
    }
}

// Load orders on page load
document.addEventListener('DOMContentLoaded', () => {
    // Wait for admin-auth.js to load
    setTimeout(() => {
        if (typeof isAuthenticated === 'function' && isAuthenticated()) {
            // Only initialize the form, don't load data until user clicks a button
            initProductForm();
            // Show main dashboard by default
            showMainDashboard();
        } else {
            window.location.href = 'admin-login.html';
        }
    }, 100);
});

// Load all orders
async function loadOrders() {
    try {
        const response = await fetch('/api/orders', {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        allOrders = await response.json();

        // Parse items JSON string
        allOrders.forEach(order => {
            if (typeof order.items === 'string') {
                order.items = JSON.parse(order.items);
            }
        });

        filteredOrders = [...allOrders];
        updateStats();
        displayOrders();
    } catch (error) {
        console.error('Error loading orders:', error);
        document.getElementById('ordersTableBody').innerHTML =
            '<tr><td colspan="8" class="error">Error loading orders. Please refresh the page.</td></tr>';
    }
}

// Update statistics
function updateStats() {
    const total = allOrders.length;
    const pending = allOrders.filter(o => o.status === 'pending').length;
    const completed = allOrders.filter(o => o.status === 'delivered').length;
    const revenue = allOrders
        .filter(o => o.status === 'delivered')
        .reduce((sum, o) => sum + parseFloat(o.total_amount), 0);

    document.getElementById('totalOrders').textContent = total;
    document.getElementById('pendingOrders').textContent = pending;
    document.getElementById('completedOrders').textContent = completed;
    document.getElementById('totalRevenue').textContent = `₹${revenue.toFixed(2)}`;
}

// Display orders in table
function displayOrders() {
    const tbody = document.getElementById('ordersTableBody');

    if (filteredOrders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="no-orders">No orders found</td></tr>';
        return;
    }

    tbody.innerHTML = filteredOrders.map(order => {
        const orderDate = new Date(order.order_date).toLocaleString();
        const itemsCount = order.items.length;
        const statusClass = getStatusClass(order.status);

        return `
            <tr>
                <td><strong>${order.order_number}</strong></td>
                <td>${order.customer_name}</td>
                <td>${order.customer_email}</td>
                <td>${itemsCount} item${itemsCount !== 1 ? 's' : ''}</td>
                <td><strong>₹${parseFloat(order.total_amount).toFixed(2)}</strong></td>
                <td>${orderDate}</td>
                <td>
                    <select class="status-select ${statusClass}" onchange="updateOrderStatus('${order.order_number}', this.value)">
                        <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>Processing</option>
                        <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>Shipped</option>
                        <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>Delivered</option>
                        <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-view" onclick="viewOrderDetails('${order.order_number}')">View</button>
                        <button class="btn-whatsapp" onclick="shareOrderToWhatsApp('${order.order_number}')" title="Share to WhatsApp">📱 WhatsApp</button>
                        <button class="btn-delete" onclick="deleteOrder('${order.order_number}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// Get status class for styling
function getStatusClass(status) {
    const classes = {
        'pending': 'status-pending',
        'processing': 'status-processing',
        'shipped': 'status-shipped',
        'delivered': 'status-delivered',
        'cancelled': 'status-cancelled'
    };
    return classes[status] || '';
}

// Filter orders
function filterOrders() {
    const statusFilter = document.getElementById('statusFilter').value;
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();

    filteredOrders = allOrders.filter(order => {
        const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
        const matchesSearch =
            order.order_number.toLowerCase().includes(searchTerm) ||
            order.customer_name.toLowerCase().includes(searchTerm) ||
            order.customer_email.toLowerCase().includes(searchTerm);

        return matchesStatus && matchesSearch;
    });

    displayOrders();
}

// Update order status
async function updateOrderStatus(orderNumber, newStatus) {
    if (!confirm(`Change order status to "${newStatus}"?`)) {
        // Reload to reset dropdown
        loadOrders();
        return;
    }

    try {
        const response = await fetch(`/api/orders/${orderNumber}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ status: newStatus })
        });

        const result = await response.json();

        if (result.success) {
            // Update local data
            const order = allOrders.find(o => o.order_number === orderNumber);
            if (order) {
                order.status = newStatus;
            }
            updateStats();
            displayOrders();
            showNotification(`Order status updated to ${newStatus}`);
        } else {
            alert('Error updating order status');
            loadOrders();
        }
    } catch (error) {
        console.error('Error updating order status:', error);
        alert('Error updating order status');
        loadOrders();
    }
}

// Helper to make URLs clickable
function formatAddressWithLink(address) {
    if (!address) return '';
    // Regex to find URLs starting with http/https
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return address.replace(urlRegex, '<a href="$1" target="_blank" style="color: #2196F3; text-decoration: underline;">$1</a>');
}

// View order details
function viewOrderDetails(orderNumber) {
    const order = allOrders.find(o => o.order_number === orderNumber);
    if (!order) return;

    const modal = document.getElementById('orderModal');
    const detailsDiv = document.getElementById('orderDetails');

    const orderDate = new Date(order.order_date).toLocaleString();

    detailsDiv.innerHTML = `
        <div class="order-detail-section">
            <h3>Order Information</h3>
            <p><strong>Order Number:</strong> ${order.order_number}</p>
            <p><strong>Order Date:</strong> ${orderDate}</p>
            <p><strong>Status:</strong> <span class="status-badge ${getStatusClass(order.status)}">${order.status}</span></p>
            ${order.coupon_code ? `<p><strong>Coupon Applied:</strong> <span style="background:#e8f5e9; color:#2e7d32; padding:2px 6px; border-radius:4px; font-weight:bold;">${order.coupon_code}</span></p>` : ''}
        </div>
        
        <div class="order-detail-section">
            <h3>Customer Information</h3>
            <p><strong>Name:</strong> ${order.customer_name}</p>
            <p><strong>Email:</strong> ${order.customer_email}</p>
            <p><strong>Phone:</strong> ${order.customer_phone || 'N/A'}</p>
        </div>
        
        <div class="order-detail-section">
            <h3>Shipping Address</h3>
            <p>${formatAddressWithLink(order.shipping_address)}</p>
            <p>${order.city}, ${order.state} ${order.zip_code}</p>
        </div>
        
        <div class="order-detail-section">
            <h3>Order Items</h3>
            <table class="items-table">
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Quantity</th>
                        <th>Price</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${order.items.map(item => `
                        <tr>
                            <td>${item.name}</td>
                            <td>${item.quantity}</td>
                            <td>₹${item.price.toFixed(2)}</td>
                            <td><strong>₹${(item.quantity * item.price).toFixed(2)}</strong></td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    ${order.coupon_code ? `
                    <tr>
                        <td colspan="3" style="text-align:right;"><strong>Subtotal:</strong></td>
                        <td>₹${parseFloat(order.total_amount).toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="3" style="text-align:right; color:#2e7d32;"><strong>Discount (${order.coupon_code}):</strong></td>
                        <td style="color:#2e7d32;">-₹${parseFloat(order.discount_amount || 0).toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="3" style="text-align:right;"><strong>Final Amount:</strong></td>
                        <td><strong>₹${parseFloat(order.final_amount || order.total_amount).toFixed(2)}</strong></td>
                    </tr>
                    ` : `
                    <tr>
                        <td colspan="3" style="text-align:right;"><strong>Total Amount:</strong></td>
                        <td><strong>₹${parseFloat(order.total_amount).toFixed(2)}</strong></td>
                    </tr>
                    `}
                </tfoot>
            </table>
        </div>
    `;

    modal.style.display = 'block';
}

// Close order modal
function closeOrderModal() {
    document.getElementById('orderModal').style.display = 'none';
}

// Close modal when clicking outside
window.onclick = function (event) {
    const orderModal = document.getElementById('orderModal');
    const productModal = document.getElementById('productModal');

    if (event.target === orderModal) {
        closeOrderModal();
    }

    if (event.target === productModal) {
        closeProductModal();
    }
}

// Refresh orders
function refreshOrders() {
    loadOrders();
    showNotification('Orders refreshed');
}

/* ===========================
   Product Management
=========================== */

function initProductForm() {
    const form = document.getElementById('productForm');
    if (form) {
        form.addEventListener('submit', handleProductSubmit);
    }
}

function normalizeProductImages(product) {
    const images = Array.isArray(product.images)
        ? product.images.filter(img => typeof img === 'string' && img.trim() !== '')
        : [];
    if (!images.length && product.image) {
        images.push(product.image);
    }
    product.images = images;
    product.primaryImage = images.length ? images[0] : (product.image || '');
    if (product.primaryImage) {
        product.image = product.primaryImage;
    }
    return product;
}

async function loadProducts() {
    try {
        const response = await fetch('/api/products', {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch products');
        }
        const payload = await response.json();
        productsList = payload.map(product => normalizeProductImages(product));
        displayProducts();
    } catch (error) {
        console.error('Error loading products:', error);
        const tbody = document.getElementById('productsTableBody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" class="error">Unable to load products. Please refresh.</td></tr>';
        }
    }
}

function displayProducts() {
    const tbody = document.getElementById('productsTableBody');
    if (!tbody) return;

    if (!productsList.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="no-orders">No products available</td></tr>';
        return;
    }

    tbody.innerHTML = productsList.map(product => `
        <tr>
            <td>
                <div class="product-name-cell">
                    <strong style="color:black">${product.name}</strong>
                    <p style="color:black">${product.description || 'No description provided'}</p>
                    <small style="color:#6c757d;">${Array.isArray(product.images) ? product.images.length : (product.image ? 1 : 0)} image(s)</small>
                </div>
            </td>
            <td style="color:black;">${product.category || '—'}</td>
            <td style="color:black;"><strong>₹${parseFloat(product.price).toFixed(2)}</strong></td>
            <td style="color:black;">${product.stock ?? 0}</td>
            <td style="color:black;">${parseFloat(product.rating || 0).toFixed(1)} ★ (${product.reviews || 0})</td>
            <td>
                <button 
                    onclick="toggleProductAvailability(${product.id}, ${!product.is_available})"
                    style="
                        padding: 6px 12px;
                        border: none;
                        border-radius: 20px;
                        font-weight: 600;
                        font-size: 12px;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        ${product.is_available
            ? 'background: linear-gradient(135deg, #4CAF50, #45a049); color: white; box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);'
            : 'background: linear-gradient(135deg, #f44336, #da190b); color: white; box-shadow: 0 2px 8px rgba(244, 67, 54, 0.3);'}
                    "
                    onmouseover="this.style.transform='scale(1.05)'"
                    onmouseout="this.style.transform='scale(1)'"
                >
                    ${product.is_available ? '✓ Available' : 'Out of Stock'}
                </button>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn-view" onclick="openProductModal(${product.id})">Edit</button>
                    <button class="btn-delete" onclick="deleteProduct(${product.id})">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openProductModal(productId = null) {
    const modal = document.getElementById('productModal');
    if (!modal) return;

    const title = document.getElementById('productModalTitle');
    const submitBtn = document.getElementById('productSubmitBtn');
    const form = document.getElementById('productForm');

    if (form) {
        form.reset();
    }

    editingProductId = productId;

    if (productId) {
        const product = productsList.find(p => p.id === productId);
        if (product) {
            document.getElementById('productName').value = product.name || '';
            document.getElementById('productCategory').value = product.category || '';
            document.getElementById('productPrice').value = product.price;
            document.getElementById('productStock').value = product.stock ?? 0;
            document.getElementById('productRating').value = product.rating ?? 0;
            document.getElementById('productReviews').value = product.reviews ?? 0;
            const imageList = Array.isArray(product.images) ? product.images : (product.image ? [product.image] : []);
            document.getElementById('productImage').value = imageList[0] || '';
            document.getElementById('productImageGallery').value = imageList.slice(1).join('\n');
            document.getElementById('productDescription').value = product.description || '';
        }
    }

    if (title) {
        title.textContent = editingProductId ? 'Edit Product' : 'Add Product';
    }
    if (submitBtn) {
        submitBtn.textContent = editingProductId ? 'Update Product' : 'Create Product';
    }

    modal.style.display = 'block';
}

function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (modal) {
        modal.style.display = 'none';
    }
    editingProductId = null;
}

async function handleProductSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('productSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = editingProductId ? 'Updating...' : 'Creating...';
    }

    const payload = {
        name: document.getElementById('productName').value.trim(),
        category: document.getElementById('productCategory').value.trim(),
        price: parseFloat(document.getElementById('productPrice').value),
        stock: parseInt(document.getElementById('productStock').value || 0, 10),
        rating: parseFloat(document.getElementById('productRating').value || 0),
        reviews: parseInt(document.getElementById('productReviews').value || 0, 10),
        image: document.getElementById('productImage').value.trim(),
        description: document.getElementById('productDescription').value.trim()
    };

    const galleryRaw = document.getElementById('productImageGallery').value || '';
    const galleryImages = galleryRaw
        .split(/\r?\n|,/)
        .map(img => img.trim())
        .filter(img => img.length > 0);

    const images = [];
    if (payload.image) {
        images.push(payload.image);
    }
    galleryImages.forEach(img => {
        if (!images.includes(img)) {
            images.push(img);
        }
    });

    payload.images = images;
    if (!payload.image && images.length) {
        payload.image = images[0];
    }

    if (!payload.name || Number.isNaN(payload.price)) {
        alert('Please provide a valid product name and price.');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = editingProductId ? 'Update Product' : 'Create Product';
        }
        return;
    }

    const method = editingProductId ? 'PUT' : 'POST';
    const url = editingProductId ? `/api/products/${editingProductId}` : '/api/products';

    try {
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.message || 'Unable to save product');
        }

        showNotification(editingProductId ? 'Product updated' : 'Product created');
        closeProductModal();
        await loadProducts();
    } catch (error) {
        console.error('Error saving product:', error);
        alert(error.message || 'Error saving product');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = editingProductId ? 'Update Product' : 'Create Product';
        }
    }
}

async function deleteProduct(productId) {
    if (!confirm('Delete this product? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/products/${productId}`, {
            method: 'DELETE',
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.message || 'Unable to delete product');
        }
        showNotification('Product deleted');
        await loadProducts();
    } catch (error) {
        console.error('Error deleting product:', error);
        alert(error.message || 'Error deleting product');
    }
}

async function toggleProductAvailability(productId, newStatus) {
    try {
        const response = await fetch(`/api/products/${productId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ is_available: newStatus })
        });
        const result = await response.json();

        if (result.success) {
            // Update local state
            const product = productsList.find(p => p.id === productId);
            if (product) {
                product.is_available = newStatus;
            }
            // Re-render the table to show updated button text
            displayProducts();
            showNotification(`Product marked as ${newStatus ? 'Available' : 'Unavailable'}`);
        } else {
            alert(result.message || 'Failed to update status');
            // Reload to reset the toggle
            loadProducts();
        }
    } catch (error) {
        console.error('Error updating availability:', error);
        alert('Error updating availability');
        loadProducts();
    }
}

function refreshProducts() {
    loadProducts();
    showNotification('Products refreshed');
}

// Share order to WhatsApp
function shareOrderToWhatsApp(orderNumber) {
    const order = allOrders.find(o => o.order_number === orderNumber);
    if (!order) return;

    // Format order items
    const itemsList = order.items.map(item =>
        `${item.name} x${item.quantity} - ₹${(item.price * item.quantity).toFixed(2)}`
    ).join('\n');

    // Extract location link from shipping address
    const locationMatch = order.shipping_address ? order.shipping_address.match(/(https?:\/\/[^\s]+)/) : null;
    const locationLink = locationMatch ? locationMatch[0] : 'Location not provided';

    // Create WhatsApp message
    const message = `🛍️ *New Order*\n` +
        `👤 *Customer Details:*\n` +
        `Name: ${order.customer_name}\n` +
        `Phone: ${order.customer_phone || 'N/A'}\n` +
        `📦 *Order Items:*\n${itemsList}\n\n` +
        `💰 *Total Amount:* ₹${parseFloat(order.total_amount).toFixed(2)}\n\n` +
        `📍 *Delivery Location:*\n${locationLink}\n\n` +
        `📅 *Order Date:* ${new Date(order.order_date).toLocaleString()}\n`;

    // Encode message for URL
    const encodedMessage = encodeURIComponent(message);

    // Open WhatsApp with prefilled message to specific number
    window.open(`https://wa.me/917087015774?text=${encodedMessage}`, '_blank');
}

// Delete an order
async function deleteOrder(orderNumber) {
    if (!confirm(`Delete order ${orderNumber}? This action cannot be undone.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/orders/${orderNumber}`, {
            method: 'DELETE',
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });

        if (!response.ok) {
            throw new Error('Failed to delete order');
        }

        await loadOrders();
        showNotification('Order deleted successfully');
    } catch (error) {
        console.error('Error deleting order:', error);
        alert('Error deleting order. Please try again.');
    }
}

// Reset all sales/orders
async function resetSales() {
    if (!confirm('This will permanently delete ALL orders and reset sales totals. Continue?')) {
        return;
    }

    if (!confirm('Are you absolutely sure? This cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch('/api/orders/reset', {
            method: 'POST',
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });

        if (!response.ok) {
            throw new Error('Failed to reset sales');
        }

        await loadOrders();
        showNotification('All orders deleted and sales reset');
    } catch (error) {
        console.error('Error resetting sales:', error);
        alert('Error resetting sales. Please try again.');
    }
}

// Show notification
function showNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}


// Load shipping settings
async function loadShippingSettings() {
    try {
        const response = await fetch('/api/settings/shipping', {
            headers: { 'ngrok-skip-browser-warning': 'true' }
        });
        const data = await response.json();
        if (data.rate !== undefined) {
            document.getElementById('shippingRate').value = data.rate;
        }
    } catch (error) {
        console.error('Error loading shipping settings:', error);
        showNotification('Error loading settings');
    }
}

// Save shipping settings
async function saveShippingSettings() {
    const rate = document.getElementById('shippingRate').value;
    if (rate === '' || rate < 0) {
        alert('Please enter a valid shipping rate');
        return;
    }

    try {
        const response = await fetch('/api/settings/shipping', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify({ rate: parseFloat(rate) })
        });

        const result = await response.json();
        if (result.success) {
            showNotification('Settings saved successfully');
        } else {
            alert('Error saving settings');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Error saving settings');
    }
}
