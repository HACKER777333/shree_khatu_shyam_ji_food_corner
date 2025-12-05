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
