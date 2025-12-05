# ShopHub - E-commerce Website

An Amazon-like e-commerce website with email order integration and UPI payment QR codes.

## Features

- 🛍️ Product catalog with categories
- 🛒 Shopping cart functionality
- 💳 Checkout process with UPI payment QR code
- 📧 Automatic email notifications for orders
- 📱 Responsive design
- 🔍 Product search
- 💰 UPI payment integration with QR code generation
- 👤 Firebase-backed user authentication (login + signup)
- 📊 Admin dashboard for order management
- 🔄 Order status updates (Pending, Processing, Shipped, Delivered, Cancelled)
- 📦 Order tracking for customers (track order status using order number)

## Setup Instructions

### Prerequisites
- Python 3.7 or higher
- pip (Python package manager)

### Installation

1. **Install Python Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

2. **Start the Server**
   ```bash
   python app.py
   ```

   The server will start on `http://localhost:5000`

3. **Configure Firebase Authentication**
   
   The repository includes a Firebase service account file at `firebase_config.json`.  
   Additionally, create a Firebase Web API key (from the Firebase Console) and add it
   to a `.env` file at the project root:
   ```
   FIREBASE_WEB_API_KEY=YOUR_FIREBASE_WEB_API_KEY
   ```
If the environment variable is not set, the app will try to read `"apiKey"` from `firebase_config.json`.
Without either value, user login will fall back to local-only authentication.
> ⚠️ Never share or commit your Firebase API key or service account file publicly.

4. **Access the Website**
   Open your browser and navigate to: `http://localhost:5000`

## Email Configuration

The email service is already configured with:
- **From Email:** shophub660@gmail.com
- **Admin Email:** pranavbadal@gmail.com
- **App Password:** Already configured in app.py

When a customer places an order:
- **Admin receives** an email notification at pranavbadal@gmail.com with all order details
- **Customer receives** a confirmation email at the email address they provided during checkout with order confirmation and details

## Payment Configuration

- **UPI ID:** priyankjain2047@fam
- QR codes are automatically generated for each order amount
- Customers must confirm payment before placing the order

## Project Structure

```
├── app.py             # Flask server with API endpoints
├── requirements.txt   # Python dependencies
├── ecommerce.db       # SQLite database (created automatically)
├── public/
│   ├── index.html     # Main HTML file
│   ├── styles.css     # Styling
│   └── script.js      # Frontend JavaScript
└── README.md          # This file
```

## API Endpoints

- `GET /api/products` - Get all products
- `GET /api/products/<id>` - Get single product
- `GET /api/payment/qrcode?amount=<amount>` - Generate UPI QR code
- `POST /api/orders` - Create new order (sends email)
- `GET /api/orders` - Get all orders

## Technologies Used

- **Backend:** Python, Flask
- **Database:** SQLite3
- **Email:** smtplib with Gmail SMTP
- **QR Code:** qrcode library
- **Frontend:** HTML, CSS, JavaScript

## Order Tracking

Customers can track their order status using their order number:

1. **Access Order Tracking:**
   - Click the "📦 Track Order" link in the website header, or
   - Navigate to `/order-tracking.html`
   - Or use the link provided in the order confirmation email

2. **Track Your Order:**
   - Enter your order number (e.g., ORD-1234567890-ABC123)
   - Click "Track Order"
   - View complete order details including:
     - Current order status
     - Status timeline (visual progress)
     - Customer information
     - Shipping address
     - Order items and total amount

3. **Features:**
   - Real-time order status updates
   - Visual timeline showing order progress
   - Complete order details
   - Responsive design for mobile devices

## User & Admin Authentication

- Visit `/login.html` (or click the "🔐 Login" / "📝 Sign Up" buttons in the header) to log in or create an account.
- All shoppers must log in before they can access the store, track orders, or place new orders.
- The signup tab supports creating a new account via Firebase Authentication (email + password).
- Use the special admin credentials to access the admin dashboard:
  - **Email:** `sj4597225@gmail.com`
  - **Password:** `IAMDEVIL123`
  - Admins are automatically redirected to `/admin-dashboard.html` after logging in.

### Admin Features
- View all orders with detailed information
- Update order status (Pending → Processing → Shipped → Delivered)
- Filter orders by status
- Search orders by order number or customer name
- View order statistics (Total Orders, Pending, Completed, Revenue)
- View detailed order information including customer details and items

### Order Status Flow
- **Pending** - Order just placed
- **Processing** - Order is being prepared
- **Shipped** - Order has been shipped
- **Delivered** - Order delivered to customer
- **Cancelled** - Order cancelled

## Notes

- The database is automatically created on first run
- Sample products are automatically added if the database is empty
- Cart data is stored in browser localStorage
- Orders are stored in the SQLite database
- QR codes are generated dynamically based on order amount
- Firebase Authentication secures both shoppers and administrator access
- Keep `firebase_config.json` and your Firebase API key private

