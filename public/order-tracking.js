// Order Tracking Functionality

// No authentication required - anyone with order number can track

// Update cart count on page load
window.addEventListener('DOMContentLoaded', () => {
    updateCartCount();
});

// Update cart count
function updateCartCount() {
    const cartCount = document.getElementById('cartCount');
    if (!cartCount) return;
    
    const savedCart = localStorage.getItem('cart');
    if (savedCart) {
        try {
            const cart = JSON.parse(savedCart);
            const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
            cartCount.textContent = totalItems;
            cartCount.style.display = totalItems > 0 ? 'flex' : 'none';
        } catch (e) {
            cartCount.style.display = 'none';
        }
    } else {
        cartCount.style.display = 'none';
    }
}

// Go back function
function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = '/home';
    }
}

// Track order function
async function trackOrder(event) {
    if (event) {
        event.preventDefault();
    }
    
    const orderNumber = document.getElementById('orderNumberInput').value.trim();
    
    if (!orderNumber) {
        alert('Please enter an order number');
        return;
    }
    
    // Hide previous states
    document.getElementById('orderDetails').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('loadingState').style.display = 'block';
    
    try {
        const response = await fetch(`/api/orders/track/${encodeURIComponent(orderNumber)}`);
        
        if (response.status === 404) {
            // Order not found
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('errorState').style.display = 'block';
            document.getElementById('errorMessage').textContent = 
                'The order number you entered could not be found. Please check and try again.';
            return;
        }
        
        if (!response.ok) {
            throw new Error('Failed to fetch order');
        }
        
        const order = await response.json();
        
        // Parse items if it's a string
        if (typeof order.items === 'string') {
            order.items = JSON.parse(order.items);
        }
        
        // Display order details
        displayOrderDetails(order);
        
    } catch (error) {
        console.error('Error tracking order:', error);
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('errorState').style.display = 'block';
        document.getElementById('errorMessage').textContent = 
            'An error occurred while fetching order details. Please try again.';
    }
}

// Display order details
function displayOrderDetails(order) {
    // Hide loading and error states
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    
    // Update order information
    document.getElementById('orderNumberDisplay').textContent = order.order_number;
    document.getElementById('orderDate').textContent = new Date(order.order_date).toLocaleString();
    
    // Update status badge
    const statusBadge = document.getElementById('statusBadge');
    statusBadge.textContent = order.status.charAt(0).toUpperCase() + order.status.slice(1);
    statusBadge.className = 'status-badge-large status-' + order.status;
    
    // Update customer information
    document.getElementById('customerName').textContent = order.customer_name;
    document.getElementById('customerEmail').textContent = order.customer_email;
    document.getElementById('customerPhone').textContent = order.customer_phone || 'N/A';
    
    // Update shipping address
    document.getElementById('shippingAddress').textContent = order.shipping_address;
    document.getElementById('shippingCity').textContent = `${order.city}, ${order.state} ${order.zip_code}`;
    
    // Update order items
    const itemsTable = document.getElementById('orderItemsTable');
    itemsTable.innerHTML = order.items.map(item => `
        <tr>
            <td style="color: rgb(0, 0, 0);"><strong>${item.name}</strong></td>
            <td style="color: rgb(0, 0, 0);">${item.quantity}</td>
            <td style="color: rgb(0, 0, 0);">₹${item.price.toFixed(2)}</td>
            <td style="color: rgb(0, 0, 0);"><strong>₹${(item.quantity * item.price).toFixed(2)}</strong></td>
        </tr>
    `).join('');
    
    document.getElementById('totalAmount').textContent = `₹${parseFloat(order.total_amount).toFixed(2)}`;
    
    // Update timeline
    updateTimeline(order.status);
    
    // Show order details
    document.getElementById('orderDetails').style.display = 'block';
    
    // Scroll to order details
    document.getElementById('orderDetails').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Update timeline based on status
function updateTimeline(status) {
    const statuses = ['pending', 'processing', 'shipped', 'delivered'];
    const statusIndex = statuses.indexOf(status);
    
    // Reset all timeline items
    statuses.forEach((s, index) => {
        const item = document.getElementById(`timeline-${s}`);
        item.classList.remove('active', 'completed');
        
        if (index < statusIndex) {
            // Completed statuses
            item.classList.add('completed');
        } else if (index === statusIndex) {
            // Current status
            item.classList.add('active');
        }
    });
    
    // Handle cancelled status
    if (status === 'cancelled') {
        statuses.forEach(s => {
            document.getElementById(`timeline-${s}`).classList.remove('active', 'completed');
        });
    }
}

// Track another order
function trackAnotherOrder() {
    document.getElementById('orderDetails').style.display = 'none';
    document.getElementById('orderNumberInput').value = '';
    document.getElementById('orderNumberInput').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Check if order number is in URL and load user orders
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const orderNumber = urlParams.get('order');
    
    // Load user orders if logged in
    if (typeof isUserAuthenticated === 'function' && isUserAuthenticated()) {
        loadUserOrders();
    }
    
    if (orderNumber) {
        document.getElementById('orderNumberInput').value = orderNumber;
        // Auto-track the order after a short delay to ensure form is ready
        setTimeout(() => {
            trackOrder(null);
        }, 100);
    }
});

// Load all orders for the logged-in user
async function loadUserOrders() {
    if (typeof isUserAuthenticated !== 'function' || !isUserAuthenticated()) {
        return;
    }
    
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    if (!user || !user.email) {
        return;
    }
    
    try {
        const response = await fetch(`/api/orders/user/${encodeURIComponent(user.email)}`);
        if (!response.ok) {
            throw new Error('Failed to fetch orders');
        }
        
        const data = await response.json();
        if (data.success && data.orders && data.orders.length > 0) {
            displayUserOrders(data.orders);
        }
    } catch (error) {
        console.error('Error loading user orders:', error);
    }
}

// Display user orders
function displayUserOrders(orders) {
    const userOrdersSection = document.getElementById('userOrdersSection');
    const userOrdersList = document.getElementById('userOrdersList');
    const trackingSubtitle = document.getElementById('trackingSubtitle');
    
    if (!userOrdersSection || !userOrdersList) return;
    
    // Update subtitle
    if (trackingSubtitle) {
        trackingSubtitle.textContent = `You have ${orders.length} order${orders.length > 1 ? 's' : ''}. Track by order number or view details below.`;
    }
    
    // Show user orders section
    userOrdersSection.style.display = 'block';
    
    // Display orders
    userOrdersList.innerHTML = orders.map((order, index) => {
        const orderDate = new Date(order.order_date).toLocaleString();
        const statusClass = `status-${order.status}`;
        const statusText = order.status.charAt(0).toUpperCase() + order.status.slice(1);
        
        // Parse items if string
        let items = order.items;
        if (typeof items === 'string') {
            try {
                items = JSON.parse(items);
            } catch (e) {
                items = [];
            }
        }
        
        const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
        
        return `
            <div class="order-card" style="background: white; border-radius: 12px; padding: 25px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
                    <div>
                        <h3 style="margin: 0 0 10px 0; color: var(--amazon-text);">Order ${index + 1}</h3>
                        <p style="margin: 0; color: var(--amazon-text-light); font-size: 14px;">
                            <strong>Order #:</strong> ${order.order_number}
                        </p>
                        <p style="margin: 5px 0 0 0; color: var(--amazon-text-light); font-size: 14px;">
                            <strong>Placed on:</strong> ${orderDate}
                        </p>
                    </div>
                    <div class="status-badge-large ${statusClass}" style="padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                        ${statusText}
                    </div>
                </div>
                
                <div style="margin-bottom: 15px;">
                    <p style="margin: 0; color: var(--amazon-text);">
                        <strong>${totalItems}</strong> item${totalItems > 1 ? 's' : ''} • Total: <strong style="color: var(--amazon-orange);">₹${parseFloat(order.total_amount).toFixed(2)}</strong>
                    </p>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 15px;">
                    <button onclick="trackOrderByNumber('${order.order_number}')" 
                            style="padding: 10px 20px; background: var(--amazon-orange); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; transition: all 0.2s;"
                            onmouseover="this.style.background='var(--amazon-orange-dark)'"
                            onmouseout="this.style.background='var(--amazon-orange)'">
                        View Details
                    </button>
                    <a href="maal.html" 
                       style="padding: 10px 20px; background: white; color: var(--amazon-text); border: 1px solid var(--amazon-border); border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block; transition: all 0.2s;"
                       onmouseover="this.style.background='var(--amazon-gray)'"
                       onmouseout="this.style.background='white'">
                        Shop Again
                    </a>
                </div>
            </div>
        `;
    }).join('');
}

// Track order by order number
function trackOrderByNumber(orderNumber) {
    document.getElementById('orderNumberInput').value = orderNumber;
    trackOrder(null);
    // Scroll to order details
    setTimeout(() => {
        const orderDetails = document.getElementById('orderDetails');
        if (orderDetails) {
            orderDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 500);
}

