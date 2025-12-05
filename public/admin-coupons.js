// Admin Coupons Management JavaScript

let coupons = [];
let editingCouponId = null;

// Load coupons on page load
document.addEventListener('DOMContentLoaded', () => {
    loadCoupons();

    // Setup form submit
    document.getElementById('couponForm').addEventListener('submit', saveCoupon);
});

async function loadCoupons() {
    try {
        const response = await fetch('/api/admin/coupons');
        const data = await response.json();

        if (data.success) {
            coupons = data.coupons;
            renderCouponsTable();
        } else {
            alert('Failed to load coupons');
        }
    } catch (error) {
        console.error('Error loading coupons:', error);
        alert('Error loading coupons');
    }
}

function renderCouponsTable() {
    const tbody = document.getElementById('couponsTableBody');

    if (!coupons.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="loading">No coupons found. Click "Add Coupon" to create one.</td></tr>';
        return;
    }

    tbody.innerHTML = coupons.map(coupon => {
        const status = getCouponStatus(coupon);
        const statusClass = status === 'Active' ? 'status-active' :
            status === 'Expired' ? 'status-expired' : 'status-used-up';

        return `
            <tr>
                <td><strong>${coupon.code}</strong></td>
                <td>${coupon.discount_type === 'percentage' ? 'Percentage' : 'Fixed'}</td>
                <td>${coupon.discount_type === 'percentage' ? coupon.discount_value + '%' : '₹' + coupon.discount_value}</td>
                <td>₹${coupon.min_order_value || 0}</td>
                <td>${coupon.used_count || 0}${coupon.usage_limit ? ' / ' + coupon.usage_limit : ' / ∞'}</td>
                <td>${coupon.expiry_date || 'No expiry'}</td>
                <td><span class="coupon-status ${statusClass}">${status}</span></td>
                <td>
                    <button onclick="editCoupon(${coupon.id})" class="btn-edit" style="margin-right: 5px;">Edit</button>
                    <button onclick="toggleCouponStatus(${coupon.id}, ${coupon.is_active})" class="btn-secondary" style="margin-right: 5px;">
                        ${coupon.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button onclick="deleteCoupon(${coupon.id})" class="btn-delete">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function getCouponStatus(coupon) {
    if (!coupon.is_active) return 'Inactive';

    // Check expiry
    if (coupon.expiry_date) {
        const expiry = new Date(coupon.expiry_date);
        if (new Date() > expiry) return 'Expired';
    }

    // Check usage limit
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
        return 'Used Up';
    }

    return 'Active';
}

function openCouponModal() {
    editingCouponId = null;
    document.getElementById('couponModalTitle').textContent = 'Add Coupon';
    document.getElementById('couponForm').reset();
    document.getElementById('couponId').value = '';
    document.getElementById('couponModal').classList.add('show');
}

function closeCouponModal() {
    document.getElementById('couponModal').classList.remove('show');
}

function editCoupon(id) {
    const coupon = coupons.find(c => c.id === id);
    if (!coupon) return;

    editingCouponId = id;
    document.getElementById('couponModalTitle').textContent = 'Edit Coupon';
    document.getElementById('couponId').value = coupon.id;
    document.getElementById('couponCode').value = coupon.code;
    document.getElementById('discountType').value = coupon.discount_type;
    document.getElementById('discountValue').value = coupon.discount_value;
    document.getElementById('minOrderValue').value = coupon.min_order_value || '';
    document.getElementById('maxDiscount').value = coupon.max_discount || '';
    document.getElementById('usageLimit').value = coupon.usage_limit || '';
    document.getElementById('expiryDate').value = coupon.expiry_date || '';

    document.getElementById('couponModal').classList.add('show');
}

async function saveCoupon(e) {
    e.preventDefault();

    const couponData = {
        code: document.getElementById('couponCode').value.toUpperCase().trim(),
        discount_type: document.getElementById('discountType').value,
        discount_value: parseFloat(document.getElementById('discountValue').value),
        min_order_value: parseFloat(document.getElementById('minOrderValue').value) || 0,
        max_discount: parseFloat(document.getElementById('maxDiscount').value) || null,
        usage_limit: parseInt(document.getElementById('usageLimit').value) || null,
        expiry_date: document.getElementById('expiryDate').value || null
    };

    const submitBtn = document.getElementById('couponSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
        let response;
        if (editingCouponId) {
            // Update existing coupon
            response = await fetch(`/api/admin/coupons/${editingCouponId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(couponData)
            });
        } else {
            // Create new coupon
            response = await fetch('/api/admin/coupons', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(couponData)
            });
        }

        const result = await response.json();

        if (result.success) {
            alert(editingCouponId ? 'Coupon updated successfully!' : 'Coupon created successfully!');
            closeCouponModal();
            loadCoupons();
        } else {
            alert(result.message || 'Failed to save coupon');
        }
    } catch (error) {
        console.error('Error saving coupon:', error);
        alert('Error saving coupon');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Coupon';
    }
}

async function toggleCouponStatus(id, currentStatus) {
    if (!confirm(`Are you sure you want to ${currentStatus ? 'disable' : 'enable'} this coupon?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/coupons/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: currentStatus ? 0 : 1 })
        });

        const result = await response.json();

        if (result.success) {
            alert('Coupon status updated!');
            loadCoupons();
        } else {
            alert('Failed to update coupon status');
        }
    } catch (error) {
        console.error('Error updating coupon:', error);
        alert('Error updating coupon');
    }
}

async function deleteCoupon(id) {
    if (!confirm('Are you sure you want to delete this coupon? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/coupons/${id}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            alert('Coupon deleted successfully!');
            loadCoupons();
        } else {
            alert('Failed to delete coupon');
        }
    } catch (error) {
        console.error('Error deleting coupon:', error);
        alert('Error deleting coupon');
    }
}

function adminLogout() {
    localStorage.removeItem('adminAuth');
    window.location.href = 'admin-login.html';
}
