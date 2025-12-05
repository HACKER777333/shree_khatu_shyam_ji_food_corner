from flask import Flask, jsonify, request, send_from_directory, redirect
from flask_cors import CORS
import sqlite3
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import qrcode
from io import BytesIO
import base64
import os
import json
from datetime import datetime
import random
import string
import hashlib
import requests
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
from firebase_admin import firestore
from dotenv import load_dotenv
from typing import Optional
import time

load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FIREBASE_CONFIG_PATH = os.path.join(BASE_DIR, 'firebase_config.json')
PUBLIC_APP_URL = os.getenv('PUBLIC_APP_URL', 'https://apposable-joannie-kissingly.ngrok-free.dev').rstrip('/')


def load_firebase_api_key() -> Optional[str]:
    env_key = os.getenv('FIREBASE_WEB_API_KEY')
    if env_key:
        return env_key.strip()

    # For web API key, check .env file first
    # Service account JSON (firebase_config.json) doesn't contain apiKey
    # apiKey is only for client-side Firebase SDK
    return None


FIREBASE_WEB_API_KEY = load_firebase_api_key()

if not FIREBASE_WEB_API_KEY:
    print("[WARN] Firebase Web API key not found. Falling back to local authentication for user logins.")

# Initialize Firebase Admin SDK
firebase_credentials = credentials.Certificate(FIREBASE_CONFIG_PATH)
firebase_app = firebase_admin.initialize_app(firebase_credentials)
# Firestore client (for cart and other per-user data)
firestore_client = firestore.client()

app = Flask(__name__, static_folder='public')
CORS(app)

@app.route('/admin-coupons.html')
def admin_coupons_page():
    return send_from_directory('public', 'admin-coupons.html')

@app.route('/admin-coupons.js')
def admin_coupons_js():
    return send_from_directory('public', 'admin-coupons.js')


def hash_password(password: str) -> str:
    """Hash passwords before storing locally (for backup reference)."""
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(stored_hash: Optional[str], candidate: str) -> bool:
    if not stored_hash:
        return False
    return stored_hash == hash_password(candidate)


def get_db_connection():
    conn = sqlite3.connect('ecommerce.db')
    conn.row_factory = sqlite3.Row
    return conn


def fetch_local_user(email: str) -> Optional[sqlite3.Row]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()
    conn.close()
    return user


def ensure_local_user_record(email: str, password: str, firebase_uid: Optional[str] = None) -> sqlite3.Row:
    user = fetch_local_user(email)
    if user:
        return user

    name = email.split('@')[0]
    phone = ''

    if firebase_uid:
        try:
            firebase_user = firebase_auth.get_user(firebase_uid)
            if firebase_user.display_name:
                name = firebase_user.display_name
            if firebase_user.phone_number:
                phone = firebase_user.phone_number
        except firebase_auth.UserNotFoundError:
            print(f"[WARN] Firebase user {firebase_uid} not found while creating local user record.")
        except Exception as exc:
            print(f"[WARN] Unable to read Firebase profile for {firebase_uid}: {exc}")

    conn = sqlite3.connect('ecommerce.db')
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO users (name, email, password, phone)
        VALUES (?, ?, ?, ?)
    ''', (name, email, hash_password(password), phone))
    conn.commit()
    conn.close()
    return fetch_local_user(email)


def authenticate_locally(email: str, password: str) -> dict:
    user = fetch_local_user(email)
    if not user:
        return {'success': False, 'message': 'Invalid email or password', 'status': 401}

    if not verify_password(user['password'], password):
        return {'success': False, 'message': 'Invalid email or password', 'status': 401}

    return {'success': True, 'user': user, 'status': 200}


def build_user_response(user_row: Optional[sqlite3.Row]) -> dict:
    if user_row is None:
        return {'success': False, 'message': 'User not found'}
    
    return {
        'success': True,
        'user': {
            'id': user_row['id'],
            'name': user_row['name'],
            'email': user_row['email'],
            'phone': user_row['phone'] if user_row['phone'] else ''
        }
    }


def sign_in_with_firebase(email: str, password: str) -> dict:
    try:
        firebase_resp = requests.post(
            f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_WEB_API_KEY}',
            json={
                'email': email,
                'password': password,
                'returnSecureToken': True
            },
            timeout=10
        )

        firebase_data = firebase_resp.json()
        if firebase_resp.status_code == 200:
            return {'success': True, 'data': firebase_data}

        error_code = firebase_data.get('error', {}).get('message')
        friendly_messages = {
            'EMAIL_NOT_FOUND': 'Invalid email or password',
            'INVALID_PASSWORD': 'Invalid email or password',
            'USER_DISABLED': 'Your account has been disabled. Please contact support.'
        }
        message = friendly_messages.get(error_code, 'Unable to sign in with Firebase')
        return {'success': False, 'message': message, 'status': 401}
    except requests.exceptions.RequestException:
        return {
            'success': False,
            'message': 'Authentication service is unreachable. Please try again shortly.',
            'status': 503
        }

@app.route('/api/users/google-login', methods=['POST'])
def google_login_sync():
    data = request.json or {}
    email = data.get('email')
    name = data.get('name')
    uid = data.get('uid')
    phone = data.get('phone', '')

    if not email:
        return jsonify({'success': False, 'message': 'Email is required'}), 400

    # Ensure user exists in local DB
    # We use a dummy password for Google users since we don't know their real one
    # and they should only login via Google anyway.
    dummy_password = f"GOOGLE_AUTH_{uid}_{email}"
    
    try:
        user = ensure_local_user_record(email, dummy_password, uid)
        
        # If phone was provided and user didn't have one, update it
        if phone and not user['phone']:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("UPDATE users SET phone = ? WHERE email = ?", (phone, email))
            conn.commit()
            conn.close()
            user = fetch_local_user(email)

        return jsonify(build_user_response(user))
    except Exception as e:
        print(f"Error syncing Google user: {e}")
        return jsonify({'success': False, 'message': 'Internal server error'}), 500

# Database setup
def init_db():
    conn = sqlite3.connect('ecommerce.db')
    cursor = conn.cursor()
    
    # Products table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            image TEXT,
            category TEXT,
            stock INTEGER DEFAULT 100,
            rating REAL DEFAULT 4.5,
            reviews INTEGER DEFAULT 0,
            extra_images TEXT DEFAULT '[]'
        )
    ''')

    # Ensure legacy databases have the extra_images column
    cursor.execute("PRAGMA table_info(products)")
    product_columns = [col[1] for col in cursor.fetchall()]
    if 'extra_images' not in product_columns:
        try:
            cursor.execute('ALTER TABLE products ADD COLUMN extra_images TEXT DEFAULT "[]"')
        except sqlite3.OperationalError:
            pass # Column likely already exists

    # Ensure legacy databases have the is_available column
    if 'is_available' not in product_columns:
        try:
            cursor.execute('ALTER TABLE products ADD COLUMN is_available BOOLEAN DEFAULT 1')
        except sqlite3.OperationalError:
            pass # Column likely already exists
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            phone TEXT,
            cart TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Ensure legacy databases have the cart column
    cursor.execute("PRAGMA table_info(users)")
    user_columns = [col[1] for col in cursor.fetchall()]
    if 'cart' not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN cart TEXT DEFAULT '[]'")
    
    # Orders table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number TEXT UNIQUE NOT NULL,
            customer_name TEXT NOT NULL,
            customer_email TEXT NOT NULL,
            customer_phone TEXT,
            shipping_address TEXT NOT NULL,
            city TEXT NOT NULL,
            state TEXT NOT NULL,
            zip_code TEXT NOT NULL,
            total_amount REAL NOT NULL,
            items TEXT NOT NULL,
            order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'pending',
            coupon_code TEXT DEFAULT NULL,
            discount_amount REAL DEFAULT 0,
            final_amount REAL
        )
    ''')
    
    # Ensure legacy databases have coupon columns
    cursor.execute("PRAGMA table_info(orders)")
    order_columns = [col[1] for col in cursor.fetchall()]
    if 'coupon_code' not in order_columns:
        cursor.execute("ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT NULL")
    if 'discount_amount' not in order_columns:
        cursor.execute("ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0")
    if 'final_amount' not in order_columns:
        cursor.execute("ALTER TABLE orders ADD COLUMN final_amount REAL")
    
    # Coupons table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            discount_type TEXT NOT NULL,
            discount_value REAL NOT NULL,
            min_order_value REAL DEFAULT 0,
            max_discount REAL DEFAULT NULL,
            usage_limit INTEGER DEFAULT NULL,
            used_count INTEGER DEFAULT 0,
            expiry_date TEXT DEFAULT NULL,
            is_active INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Settings table for dynamic configurations
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    
    # Insert default shipping rate if not exists
    cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", ('shipping_rate_per_km', '5.0'))
    
    # Check if products table is empty and insert sample products
    cursor.execute("SELECT COUNT(*) FROM products")
    count = cursor.fetchone()[0]
    
    if count == 0:
        sample_products = [
            ("Wireless Bluetooth Headphones", "Premium noise-cancelling headphones with 30-hour battery life", 79.99, 
             "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500", "Electronics", 50, 4.5, 234),
            ("Smart Watch Pro", "Fitness tracker with heart rate monitor and GPS", 199.99,
             "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500", "Electronics", 30, 4.7, 189),
            ("Laptop Backpack", "Water-resistant backpack with USB charging port", 49.99,
             "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=500", "Accessories", 75, 4.3, 156),
            ("Wireless Mouse", "Ergonomic wireless mouse with 2-year battery life", 29.99,
             "https://images.unsplash.com/photo-1527814050087-3793815479db?w=500", "Electronics", 100, 4.4, 312),
            ("Mechanical Keyboard", "RGB backlit mechanical keyboard with blue switches", 89.99,
             "https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=500", "Electronics", 45, 4.6, 278),
            ("USB-C Hub", "7-in-1 USB-C hub with HDMI, USB 3.0, and SD card reader", 39.99,
             "https://images.unsplash.com/photo-1587825147138-346c006b1e98?w=500", "Accessories", 60, 4.2, 145),
            ("Phone Stand", "Adjustable aluminum phone stand for desk", 19.99,
             "https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=500", "Accessories", 90, 4.1, 98),
            ("Power Bank 20000mAh", "Fast charging power bank with dual USB ports", 34.99,
             "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c8?w=500", "Electronics", 55, 4.5, 201)
        ]
        
        cursor.executemany('''
            INSERT INTO products (name, description, price, image, category, stock, rating, reviews)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', sample_products)
    
    conn.commit()
    conn.close()

# Email configuration
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
EMAIL_USER = "tastejunction05@gmail.com"
EMAIL_PASSWORD = "qqvx utei zrow acsv"
RECIPIENT_EMAIL = "tastejunction05@gmail.com"

# Email verification removed - using Firebase Authentication directly

# send_verification_email removed - using Firebase Authentication

def send_admin_email(order_data):
    """Send order notification email to admin"""
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"New Order #{order_data['order_number']}"
        msg['From'] = EMAIL_USER
        msg['To'] = RECIPIENT_EMAIL
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #232f3e; color: white; padding: 20px; text-align: center; }}
                .content {{ background-color: #f9f9f9; padding: 20px; }}
                .order-info {{ background-color: white; padding: 15px; margin: 10px 0; border-radius: 5px; }}
                .item {{ border-bottom: 1px solid #ddd; padding: 10px 0; }}
                .total {{ font-size: 18px; font-weight: bold; color: #e67e22; margin-top: 15px; }}
                .footer {{ text-align: center; padding: 20px; color: #666; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🛒 New Order Received</h1>
                </div>
                <div class="content">
                    <div class="order-info">
                        <h2>Order Details</h2>
                        <p><strong>Order Number:</strong> {order_data['order_number']}</p>
                        <p><strong>Order Date:</strong> {order_data['order_date']}</p>
                    </div>
                    
                    <div class="order-info">
                        <h2>Customer Information</h2>
                        <p><strong>Name:</strong> {order_data['customer_name']}</p>
                        <p><strong>Email:</strong> {order_data['customer_email']}</p>
                        <p><strong>Phone:</strong> {order_data.get('customer_phone', 'N/A')}</p>
                    </div>
                    
                    <div class="order-info">
                        <h2>Shipping Address</h2>
                        <p>{order_data['shipping_address']}</p>
                        <p>{order_data['city']}, {order_data['state']} {order_data['zip_code']}</p>
                    </div>
                    
                    <div class="order-info">
                        <h2>Order Items</h2>
                        {''.join([f'''
                        <div class="item">
                            <p><strong>{item['name']}</strong></p>
                            <p>Quantity: {item['quantity']} × ₹{item['price']:.2f} = ₹{item['quantity'] * item['price']:.2f}</p>
                        </div>
                        ''' for item in order_data['items']])}
                        <div class="total">
                            <p>Total Amount: ₹{order_data['total_amount']:.2f}</p>
                        </div>
                    </div>
                    
                    <div class="order-info">
                        <p><strong>Status:</strong> {order_data['status']}</p>
                    </div>
                </div>
                <div class="footer">
                    <p>This is an automated email from your e-commerce website.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(html_content, 'html'))
        
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(EMAIL_USER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        
        print(f"Admin email sent successfully for order #{order_data['order_number']}")
    except Exception as e:
        print(f"Error sending admin email: {str(e)}")

def send_feedback_email(feedback_data):
    """Send feedback email to admin"""
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"New Feedback from {feedback_data['name']}"
        msg['From'] = EMAIL_USER
        msg['To'] = RECIPIENT_EMAIL
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #7f5bff; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }}
                .content {{ background-color: #f9f9f9; padding: 20px; }}
                .info-box {{ background-color: white; padding: 20px; margin: 10px 0; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
                .info-item {{ margin: 15px 0; padding: 10px; background-color: #f5f5f5; border-left: 4px solid #7f5bff; }}
                .info-item strong {{ color: #7f5bff; }}
                .query-box {{ background-color: #fff9e6; padding: 20px; border-left: 4px solid #ffc107; margin: 15px 0; }}
                .footer {{ text-align: center; padding: 20px; color: #666; background-color: #f0f0f0; border-radius: 0 0 8px 8px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📝 New Feedback Received</h1>
                </div>
                <div class="content">
                    <div class="info-box">
                        <h2>Contact Information</h2>
                        <div class="info-item">
                            <strong>Name:</strong> {feedback_data['name']}
                        </div>
                        <div class="info-item">
                            <strong>Email:</strong> {feedback_data['email']}
                        </div>
                        <div class="info-item">
                            <strong>Phone:</strong> {feedback_data['phone']}
                        </div>
                    </div>
                    
                    <div class="query-box">
                        <h2>Query / Feedback</h2>
                        <p style="white-space: pre-wrap; line-height: 1.8;">{feedback_data['query']}</p>
                    </div>
                </div>
                <div class="footer">
                    <p><strong>ShopHub</strong></p>
                    <p style="font-size: 12px; color: #999; margin-top: 15px;">This feedback was submitted through the website contact form.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(html_content, 'html'))
        
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(EMAIL_USER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        
        print(f"Feedback email sent successfully from {feedback_data['email']}")
        return True
    except Exception as e:
        print(f"Error sending feedback email: {str(e)}")
        return False

def send_customer_email(order_data):
    """Send order confirmation email to customer"""
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"Order Confirmation - #{order_data['order_number']}"
        msg['From'] = EMAIL_USER
        msg['To'] = order_data['customer_email']
        
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #ff9900; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
                .content {{ background-color: #f9f9f9; padding: 20px; }}
                .order-info {{ background-color: white; padding: 20px; margin: 10px 0; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
                .item {{ border-bottom: 1px solid #eee; padding: 12px 0; }}
                .item:last-child {{ border-bottom: none; }}
                .total {{ font-size: 22px; font-weight: bold; color: #ff9900; margin-top: 20px; padding-top: 15px; border-top: 2px solid #ddd; }}
                .footer {{ text-align: center; padding: 20px; color: #666; background-color: #f0f0f0; border-radius: 0 0 8px 8px; }}
                .success-badge {{ background-color: #28a745; color: white; padding: 10px 20px; border-radius: 20px; display: inline-block; margin-bottom: 20px; }}
                .order-number {{ font-size: 24px; font-weight: bold; margin: 10px 0; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🎉 Thank You for Your Order!</h1>
                    <div class="success-badge">Order Confirmed</div>
                    <div class="order-number">Order #{order_data['order_number']}</div>
                </div>
                <div class="content">
                    <div class="order-info">
                        <h2>Hello {order_data['customer_name']},</h2>
                        <p>We're excited to confirm that your order has been received and is being processed!</p>
                        <p><strong>Order Date:</strong> {order_data['order_date']}</p>
                        <p><strong>Order Status:</strong> <span style="color: #28a745; font-weight: bold;">{order_data['status'].title()}</span></p>
                    </div>
                    
                    <div class="order-info">
                        <h2>📦 Order Items</h2>
                        {''.join([f'''
                        <div class="item">
                            <p><strong>{item['name']}</strong></p>
                            <p style="color: #666;">Quantity: {item['quantity']} × ₹{item['price']:.2f} = <strong>₹{item['quantity'] * item['price']:.2f}</strong></p>
                        </div>
                        ''' for item in order_data['items']])}
                        <div class="total">
                            <p>Total Amount: ₹{order_data['total_amount']:.2f}</p>
                        </div>
                    </div>
                    
                    <div class="order-info">
                        <h2>🚚 Shipping Address</h2>
                        <p><strong>{order_data['customer_name']}</strong></p>
                        <p>{order_data['shipping_address']}</p>
                        <p>{order_data['city']}, {order_data['state']} {order_data['zip_code']}</p>
                        <p><strong>Phone:</strong> {order_data.get('customer_phone', 'N/A')}</p>
                    </div>
                    
                    <div class="order-info" style="background-color: #e7f3ff; border-left: 4px solid #2196F3;">
                        <h2>📧 What's Next?</h2>
                        <p>• You will receive a shipping confirmation email once your order is dispatched</p>
                        <p>• Track your order status anytime using your order number: <strong>{order_data['order_number']}</strong></p>
                        <p style="text-align: center; margin-top: 20px;">
                            <a href="{PUBLIC_APP_URL}/order-tracking.html?order={order_data['order_number']}" 
                               style="background-color: #ff9900; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                                📦 Track Your Order
                            </a>
                        </p>
                        <p>• If you have any questions, please contact us at {EMAIL_USER}</p>
                    </div>
                </div>
                <div class="footer">
                    <p><strong>ShopHub</strong></p>
                    <p>Thank you for shopping with us!</p>
                    <p style="font-size: 12px; color: #999; margin-top: 15px;">This is an automated confirmation email. Please do not reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
        """
        
        msg.attach(MIMEText(html_content, 'html'))
        
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(EMAIL_USER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        
        print(f"Customer confirmation email sent to {order_data['customer_email']} for order #{order_data['order_number']}")
    except Exception as e:
        print(f"Error sending customer email: {str(e)}")

# API Routes

@app.route('/')
def root():
    return redirect('/home')

@app.route('/home')
def home():
    return send_from_directory('public', 'index.html')

@app.route('/index.html')
def index_html():
    return send_from_directory('public', 'index.html')

# Serve static files (CSS, JS, images)
@app.route('/styles.css')
def serve_css():
    return send_from_directory('public', 'styles.css')

@app.route('/script.js')
def serve_js():
    return send_from_directory('public', 'script.js')

@app.route('/cart.js')
def serve_cart_js():
    return send_from_directory('public', 'cart.js')

@app.route('/firebase-client-config.js')
def serve_firebase_config_js():
    return send_from_directory('public', 'firebase-client-config.js')

@app.route('/checkout.html')
def checkout_page():
    return send_from_directory('public', 'checkout.html')

@app.route('/payment.html')
def payment_page():
    return send_from_directory('public', 'payment.html')

@app.route('/checkout.js')
def checkout_js():
    return send_from_directory('public', 'checkout.js')

@app.route('/payment.js')
def payment_js():
    return send_from_directory('public', 'payment.js')

@app.route('/admin-login.html')
def admin_login():
    return send_from_directory('public', 'admin-login.html')

@app.route('/admin-dashboard.html')
def admin_dashboard():
    return send_from_directory('public', 'admin-dashboard.html')

@app.route('/admin-styles.css')
def admin_styles():
    return send_from_directory('public', 'admin-styles.css')

@app.route('/admin-auth.js')
def admin_auth_js():
    return send_from_directory('public', 'admin-auth.js')

@app.route('/admin-dashboard.js')
def admin_dashboard_js():
    return send_from_directory('public', 'admin-dashboard.js')

@app.route('/order-tracking.html')
def order_tracking():
    return send_from_directory('public', 'order-tracking.html')

@app.route('/tracking-styles.css')
def tracking_styles():
    return send_from_directory('public', 'tracking-styles.css')

@app.route('/order-tracking.js')
def order_tracking_js():
    return send_from_directory('public', 'order-tracking.js')

@app.route('/login.html')
def login_page():
    return send_from_directory('public', 'login.html')

@app.route('/login-styles.css')
def login_styles():
    return send_from_directory('public', 'login-styles.css')

@app.route('/feedback.html')
def feedback_page():
    return send_from_directory('public', 'feedback.html')

@app.route('/feedback')
def feedback_redirect():
    return redirect('/feedback.html')

@app.route('/user-auth.js')
def user_auth_js():
    return send_from_directory('public', 'user-auth.js')

@app.route('/maal.html')
def maal_page():
    return send_from_directory('public', 'maal.html')

@app.route('/maal')
def maal_redirect():
    return redirect('/maal.html')

@app.route('/cart.html')
def cart_page():
    return send_from_directory('public', 'cart.html')

@app.route('/cart')
def cart_redirect():
    return redirect('/cart.html')

@app.route('/products.html')
def products_page():
    return send_from_directory('public', 'maal.html')

@app.route('/products')
def products_redirect():
    return redirect('/maal.html')

def serialize_product_row(row: sqlite3.Row) -> dict:
    product = dict(row)
    try:
        extra_images = json.loads(product.get('extra_images') or '[]')
    except (TypeError, json.JSONDecodeError):
        extra_images = []
    product['extra_images'] = extra_images
    images = []
    if product.get('image'):
        images.append(product['image'])
    images.extend([img for img in extra_images if img])
    product['images'] = images
    
    # Handle is_available (default to True if missing/None)
    is_avail = product.get('is_available')
    product['is_available'] = bool(is_avail) if is_avail is not None else True
    
    return product


@app.route('/api/products', methods=['GET'])
def get_products():
    conn = sqlite3.connect('ecommerce.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM products ORDER BY id")
    rows = cursor.fetchall()
    conn.close()

    products = [serialize_product_row(row) for row in rows]
    return jsonify(products)

@app.route('/api/products/<int:product_id>', methods=['GET'])
def get_product(product_id):
    conn = sqlite3.connect('ecommerce.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM products WHERE id = ?", (product_id,))
    product = cursor.fetchone()
    conn.close()
    
    if product:
        return jsonify(serialize_product_row(product))
    else:
        return jsonify({'error': 'Product not found'}), 404


@app.route('/api/products', methods=['POST'])
def create_product():
    data = request.json or {}
    name = data.get('name')
    price = data.get('price')

    if not name or price is None:
        return jsonify({'success': False, 'message': 'Product name and price are required'}), 400

    try:
        normalized_price = float(price)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Price must be a valid number'}), 400

    incoming_images = data.get('images')
    gallery_images = []
    cover_image = data.get('image', '').strip()
    
    # Handle is_available
    is_available = data.get('is_available', True)
    if isinstance(is_available, str):
        is_available = is_available.lower() == 'true'
    is_available = 1 if is_available else 0

    # If 'images' list is provided, use the first one as cover if cover not set
    if isinstance(incoming_images, list):
        # Filter out empty strings
        normalized = [img.strip() for img in incoming_images if isinstance(img, str) and img.strip()]
        if normalized:
            cover_image = normalized[0]
            gallery_images = normalized[1:]
    else: # Fallback to old extra_images if 'images' list not provided
        extra_images_input = data.get('extra_images')
        if isinstance(extra_images_input, list):
            gallery_images = [img.strip() for img in extra_images_input if isinstance(img, str) and img.strip()]
        elif isinstance(extra_images_input, str):
            try:
                parsed_input = json.loads(extra_images_input)
                if isinstance(parsed_input, list):
                    gallery_images = [img.strip() for img in parsed_input if isinstance(img, str) and img.strip()]
            except json.JSONDecodeError:
                gallery_images = []

    product_payload = {
        'name': name.strip(),
        'description': data.get('description', ''),
        'price': normalized_price,
        'image': cover_image,
        'category': data.get('category', 'General'),
        'stock': int(data.get('stock', 0) or 0),
        'rating': float(data.get('rating', 0) or 0),
        'reviews': int(data.get('reviews', 0) or 0),
        'extra_images': json.dumps(gallery_images),
        'is_available': is_available
    }

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        '''
        INSERT INTO products (name, description, price, image, category, stock, rating, reviews, extra_images, is_available)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            product_payload['name'],
            product_payload['description'],
            product_payload['price'],
            product_payload['image'],
            product_payload['category'],
            product_payload['stock'],
            product_payload['rating'],
            product_payload['reviews'],
            product_payload['extra_images'],
            product_payload['is_available']
        )
    )
    conn.commit()
    product_id = cursor.lastrowid
    cursor.execute("SELECT * FROM products WHERE id = ?", (product_id,))
    product = cursor.fetchone()
    conn.close()
    return jsonify({'success': True, 'product': serialize_product_row(product)}), 201


@app.route('/api/products/<int:product_id>', methods=['PUT'])
def update_product(product_id):
    data = request.json or {}
    allowed_fields = ['name', 'description', 'price', 'image', 'category', 'stock', 'rating', 'reviews', 'extra_images', 'is_available']
    updates = []
    values = []

    images_payload = data.get('images')
    skip_fields = set()
    if isinstance(images_payload, list):
        normalized_images = [img.strip() for img in images_payload if isinstance(img, str) and img.strip()]
        if normalized_images:
            updates.append("image = ?")
            values.append(normalized_images[0])
            updates.append("extra_images = ?")
            values.append(json.dumps(normalized_images[1:])) # Store all images except the first as extra_images
        else:
            updates.append("extra_images = ?")
            values.append(json.dumps([]))
        skip_fields.update({'image', 'extra_images', 'images'})

    for field in allowed_fields:
        if field in skip_fields:
            continue
        if field in data:
            if field == 'extra_images':
                if isinstance(data[field], list):
                    values.append(json.dumps(data[field]))
                elif isinstance(data[field], str):
                    try:
                        parsed = json.loads(data[field])
                        values.append(json.dumps(parsed if isinstance(parsed, list) else []))
                    except json.JSONDecodeError:
                        values.append(json.dumps([]))
                else:
                    values.append(json.dumps([]))
                updates.append(f"{field} = ?")
                continue
            if field == 'is_available':
                # Handle boolean conversion
                val = data[field]
                if isinstance(val, str):
                    val = 1 if val.lower() == 'true' else 0
                else:
                    val = 1 if val else 0
                values.append(val)
                updates.append(f"{field} = ?")
                continue
            if field == 'price':
                try:
                    values.append(float(data[field]))
                except (TypeError, ValueError):
                    return jsonify({'success': False, 'message': 'Price must be a valid number'}), 400
            elif field in ['stock', 'reviews']:
                values.append(int(data[field] or 0))
            elif field == 'rating':
                values.append(float(data[field] or 0))
            else:
                values.append(data[field])
            updates.append(f"{field} = ?")

    if not updates:
        return jsonify({'success': False, 'message': 'No fields provided to update'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        f"UPDATE products SET {', '.join(updates)} WHERE id = ?",
        (*values, product_id)
    )

    if cursor.rowcount == 0:
        conn.close()
        return jsonify({'success': False, 'message': 'Product not found'}), 404

    conn.commit()
    cursor.execute("SELECT * FROM products WHERE id = ?", (product_id,))
    product = cursor.fetchone()
    conn.close()
    return jsonify({'success': True, 'product': serialize_product_row(product)})


@app.route('/api/products/<int:product_id>', methods=['DELETE'])
def delete_product(product_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM products WHERE id = ?", (product_id,))
    deleted = cursor.rowcount
    conn.commit()
    conn.close()

    if deleted == 0:
        return jsonify({'success': False, 'message': 'Product not found'}), 404

    return jsonify({'success': True, 'message': 'Product deleted successfully'})

@app.route('/api/payment/qrcode', methods=['GET'])
def generate_qrcode():
    amount = request.args.get('amount')
    upi_id = 'priyankjain2047@fam'
    
    if not amount:
        return jsonify({'error': 'Amount is required'}), 400
    
    try:
        # UPI payment URL format
        upi_url = f"upi://pay?pa={upi_id}&am={amount}&cu=INR&tn=Order Payment"
        
        # Generate QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=10,
            border=4,
        )
        qr.add_data(upi_url)
        qr.make(fit=True)
        
        # Create image
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Convert to base64
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()
        
        return jsonify({
            'qrCode': f'data:image/png;base64,{img_str}',
            'upiId': upi_id,
            'amount': float(amount),
            'upiUrl': upi_url
        })
    except Exception as e:
        print(f"Error generating QR code: {str(e)}")
        return jsonify({'error': 'Failed to generate QR code'}), 500

@app.route('/api/orders', methods=['POST'])
def create_order():
    data = request.json
    
    # Generate order number
    order_number = f"ORD-{int(datetime.now().timestamp() * 1000)}-{''.join(random.choices(string.ascii_uppercase + string.digits, k=9))}"
    
    try:
        conn = sqlite3.connect('ecommerce.db')
        cursor = conn.cursor()
        
        # Get coupon data if provided
        coupon_code = data.get('coupon_code')
        discount_amount = data.get('discount_amount', 0)
        final_amount = data.get('final_amount', data['total_amount'])
        
        cursor.execute('''
            INSERT INTO orders (order_number, customer_name, customer_email, customer_phone,
                             shipping_address, city, state, zip_code, total_amount, items, order_date, status,
                             coupon_code, discount_amount, final_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            order_number,
            data['customer_name'],
            data['customer_email'],
            data.get('customer_phone', ''),
            data['shipping_address'],
            data['city'],
            data['state'],
            data['zip_code'],
            data['total_amount'],
            json.dumps(data['items']),
            datetime.now().isoformat(),
            'pending',
            coupon_code,
            discount_amount,
            final_amount
        ))
        
        order_id = cursor.lastrowid
        
        # If coupon was used, increment usage count
        if coupon_code:
            cursor.execute('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', (coupon_code,))
        
        conn.commit()
        conn.close()
        
        # Prepare order data for email
        order_data = {
            'order_number': order_number,
            'customer_name': data['customer_name'],
            'customer_email': data['customer_email'],
            'customer_phone': data.get('customer_phone', ''),
            'shipping_address': data['shipping_address'],
            'city': data['city'],
            'state': data['state'],
            'zip_code': data['zip_code'],
            'total_amount': data['total_amount'],
            'discount_amount': discount_amount,
            'final_amount': final_amount,
            'coupon_code': coupon_code,
            'items': data['items'],
            'order_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'status': 'pending'
        }
        
        # Send emails to both admin and customer
        send_admin_email(order_data)
        send_customer_email(order_data)
        
        return jsonify({
            'success': True,
            'order': {
                'id': order_id,
                **order_data
            }
        })
    except Exception as e:
        print(f"Error creating order: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/orders', methods=['GET'])
def get_orders():
    conn = sqlite3.connect('ecommerce.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders ORDER BY order_date DESC")
    orders = [dict(row) for row in cursor.fetchall()]
    
    # Parse JSON items for each order
    for order in orders:
        order['items'] = json.loads(order['items'])
    
    conn.close()
    return jsonify(orders)

# User Authentication APIs
# /api/users/send-verification endpoint removed - using Firebase Authentication directly

@app.route('/api/users/register', methods=['POST'])
def register_user():
    """Register user directly with Firebase Authentication - no email verification"""
    data = request.json
    name = data.get('name')
    email = data.get('email')
    password = data.get('password')
    phone = data.get('phone', '')
    
    if not all([name, email, password]):
        return jsonify({'success': False, 'message': 'Name, email and password are required'}), 400
    
    # Check if email already exists locally
    if fetch_local_user(email):
        return jsonify({'success': False, 'message': 'Email already registered'}), 400
    
    try:
        # Create user in Firebase Authentication directly
        firebase_user = firebase_auth.create_user(
            email=email,
            password=password,
            display_name=name.strip() if name else None
        )
        
        # Save to local SQLite for backup
        conn = sqlite3.connect('ecommerce.db')
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO users (name, email, password, phone)
            VALUES (?, ?, ?, ?)
        ''', (name, email, hash_password(password), phone))
        user_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        print(f"[SUCCESS] User registered with Firebase: {email}")
        return jsonify({
            'success': True,
            'user': {
                'id': user_id,
                'name': name,
                'email': email,
                'phone': phone
            }
        })
    except firebase_auth.EmailAlreadyExistsError:
        return jsonify({'success': False, 'message': 'Email already registered in Firebase'}), 400
    except Exception as e:
        print(f"[ERROR] Registration failed: {str(e)}")
        return jsonify({'success': False, 'message': f'Registration failed: {str(e)}'}), 500

@app.route('/api/users/login', methods=['POST'])
def login_user():
    data = request.json
    email = data.get('email')
    password = data.get('password')
    
    if not email or not password:
        return jsonify({'success': False, 'message': 'Email and password are required'}), 400
    
    firebase_message = None
    firebase_status = None

    if FIREBASE_WEB_API_KEY:
        firebase_result = sign_in_with_firebase(email, password)
        if firebase_result['success']:
            firebase_uid = firebase_result['data'].get('localId')
            user = ensure_local_user_record(email, password, firebase_uid)
            return jsonify(build_user_response(user))

        firebase_message = firebase_result['message']
        firebase_status = firebase_result.get('status', 401)
    else:
        print("[INFO] Firebase Web API key missing; using local credential verification.")

    local_result = authenticate_locally(email, password)
    if local_result['success']:
        return jsonify(build_user_response(local_result['user']))

    error_message = local_result['message']
    error_status = local_result['status']

    if firebase_message and firebase_status and firebase_status >= 500:
        # Prefer surfacing transient auth service issues
        error_message = firebase_message
        error_status = firebase_status
    elif error_status == 401 and firebase_message and firebase_status == 401:
        # Keep messaging consistent across Firebase/local paths
        error_message = firebase_message

    return jsonify({'success': False, 'message': error_message}), error_status

@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    """Handle feedback form submission"""
    try:
        data = request.json
        name = data.get('name', '').strip()
        email = data.get('email', '').strip()
        phone = data.get('phone', '').strip()
        query = data.get('query', '').strip()
        
        # Validate required fields
        if not all([name, email, phone, query]):
            return jsonify({
                'success': False,
                'message': 'All fields are required. Please fill in all the information.'
            }), 400
        
        # Validate email format
        import re
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, email):
            return jsonify({
                'success': False,
                'message': 'Please enter a valid email address.'
            }), 400
        
        # Prepare feedback data
        feedback_data = {
            'name': name,
            'email': email,
            'phone': phone,
            'query': query
        }
        
        # Send email
        if send_feedback_email(feedback_data):
            return jsonify({
                'success': True,
                'message': 'Thank you for your feedback! We have received your message and will get back to you soon.'
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Failed to send feedback. Please try again later or contact us directly.'
            }), 500
            
    except Exception as e:
        print(f"Error processing feedback: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'message': 'An error occurred while processing your feedback. Please try again.'
        }), 500

@app.route('/api/orders/track/<order_number>', methods=['GET'])
def track_order(order_number):
    try:
        conn = sqlite3.connect('ecommerce.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM orders WHERE order_number = ?", (order_number,))
        order = cursor.fetchone()
        conn.close()
        
        if not order:
            return jsonify({'error': 'Order not found'}), 404
        
        order_dict = dict(order)
        # Parse JSON items
        order_dict['items'] = json.loads(order_dict['items'])
        
        return jsonify(order_dict)
    except Exception as e:
        print(f"Error tracking order: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/orders/user/<email>', methods=['GET'])
def get_user_orders(email):
    """Get all orders for a specific user email"""
    try:
        conn = sqlite3.connect('ecommerce.db')
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM orders WHERE customer_email = ? ORDER BY order_date DESC", (email,))
        orders = cursor.fetchall()
        conn.close()
        
        orders_list = []
        for order in orders:
            order_dict = dict(order)
            # Parse JSON items
            order_dict['items'] = json.loads(order_dict['items'])
            orders_list.append(order_dict)
        
        return jsonify({
            'success': True,
            'orders': orders_list
        })
    except Exception as e:
        print(f"Error fetching user orders: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/orders/<order_number>/status', methods=['PUT'])
def update_order_status(order_number):
    data = request.json
    new_status = data.get('status')
    
    if not new_status:
        return jsonify({'error': 'Status is required'}), 400
    
    valid_statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
    if new_status not in valid_statuses:
        return jsonify({'error': 'Invalid status'}), 400
    
    try:
        conn = sqlite3.connect('ecommerce.db')
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE orders 
            SET status = ? 
            WHERE order_number = ?
        ''', (new_status, order_number))
        
        if cursor.rowcount == 0:
            conn.close()
            return jsonify({'error': 'Order not found'}), 404
        
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': f'Order status updated to {new_status}'
        })
    except Exception as e:
        print(f"Error updating order status: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/orders/<order_number>', methods=['DELETE'])
def delete_order(order_number):
    try:
        conn = sqlite3.connect('ecommerce.db')
        cursor = conn.cursor()
        cursor.execute('DELETE FROM orders WHERE order_number = ?', (order_number,))
        deleted = cursor.rowcount
        conn.commit()
        conn.close()

        if deleted == 0:
            return jsonify({'success': False, 'message': 'Order not found'}), 404

        return jsonify({'success': True, 'message': 'Order deleted successfully'})
    except Exception as e:
        print(f"Error deleting order {order_number}: {str(e)}")
        return jsonify({'success': False, 'message': 'Error deleting order'}), 500


@app.route('/api/orders/reset', methods=['POST'])
def reset_sales():
    try:
        conn = sqlite3.connect('ecommerce.db')
        cursor = conn.cursor()
        cursor.execute('DELETE FROM orders')
        conn.commit()
        cursor.execute("DELETE FROM sqlite_sequence WHERE name = 'orders'")
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'message': 'All orders deleted and sales reset'})
    except Exception as e:
        print(f"Error resetting sales: {str(e)}")
        return jsonify({'success': False, 'message': 'Error resetting sales'}), 500

@app.route('/api/cart/save', methods=['POST'])
def save_cart():
    """Save user's cart to database and Firestore"""
    try:
        data = request.json
        email = data.get('email')
        cart_data = data.get('cart', [])
        
        if not email:
            return jsonify({'success': False, 'message': 'Email is required'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if user exists
        cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return jsonify({'success': False, 'message': 'User not found'}), 404
        
        # Update user's cart in SQLite
        cart_json = json.dumps(cart_data)
        cursor.execute("UPDATE users SET cart = ? WHERE email = ?", (cart_json, email))
        conn.commit()
        conn.close()

        # Also sync cart to Firestore for cross-device support (optional, non-blocking)
        try:
            # Use threading for timeout (Windows compatible)
            import threading
            
            firestore_error = [None]
            firestore_success = [False]
            
            def sync_to_firestore():
                try:
                    doc_ref = firestore_client.collection('carts').document(email.lower())
                    doc_ref.set({
                        'cart': cart_data,
                        'updated_at': datetime.utcnow().isoformat()
                    }, merge=True)
                    firestore_success[0] = True
                    print(f"[SUCCESS] Cart synced to Firestore for {email}")
                except Exception as e:
                    firestore_error[0] = e
            
            # Run Firestore sync in a thread with 3-second timeout
            sync_thread = threading.Thread(target=sync_to_firestore)
            sync_thread.daemon = True
            sync_thread.start()
            sync_thread.join(timeout=3.0)
            
            if sync_thread.is_alive():
                print(f"[WARN] Firestore sync timed out for {email}. Cart saved to SQLite successfully.")
            elif firestore_error[0]:
                print(f"[WARN] Error syncing cart to Firestore for {email}: {firestore_error[0]}")
                print("[INFO] Cart saved to SQLite successfully. Firestore sync is optional.")
        except Exception as fe:
            # Firestore errors should not break normal flow
            print(f"[WARN] Unexpected error in Firestore sync for {email}: {fe}")
            print("[INFO] Cart saved to SQLite successfully. Firestore sync is optional.")

        return jsonify({'success': True, 'message': 'Cart saved successfully'})
    except Exception as e:
        print(f"Error saving cart: {str(e)}")
        return jsonify({'success': False, 'message': 'Error saving cart'}), 500

@app.route('/api/cart/load', methods=['GET'])
def load_cart():
    """Load user's cart from Firestore (primary) or SQLite (fallback)"""
    try:
        email = request.args.get('email')
        
        if not email:
            return jsonify({'success': False, 'message': 'Email is required'}), 400
        
        # 1) Try Firestore first for the most up-to-date cart (with timeout)
        cart_data = []
        firestore_success = False
        
        try:
            # Use threading for timeout (Windows compatible)
            import threading
            
            firestore_result = [None]
            firestore_error = [None]
            
            def load_from_firestore():
                try:
                    doc_ref = firestore_client.collection('carts').document(email.lower())
                    doc = doc_ref.get()
                    if doc.exists:
                        doc_data = doc.to_dict() or {}
                        firestore_result[0] = doc_data.get('cart') or []
                        print(f"[SUCCESS] Cart loaded from Firestore for {email}")
                except Exception as e:
                    firestore_error[0] = e
            
            # Run Firestore load in a thread with 3-second timeout
            load_thread = threading.Thread(target=load_from_firestore)
            load_thread.daemon = True
            load_thread.start()
            load_thread.join(timeout=3.0)
            
            if load_thread.is_alive():
                print(f"[WARN] Firestore load timed out for {email}. Falling back to SQLite.")
            elif firestore_error[0]:
                print(f"[WARN] Error loading cart from Firestore for {email}: {firestore_error[0]}")
                print("[INFO] Falling back to SQLite. Firestore sync is optional.")
            elif firestore_result[0] is not None:
                cart_data = firestore_result[0]
                firestore_success = True
        except Exception as fe:
            print(f"[WARN] Unexpected error in Firestore load for {email}: {fe}")
            print("[INFO] Falling back to SQLite. Firestore sync is optional.")

        # 2) If Firestore has no cart or failed, fall back to SQLite
        if not cart_data and not firestore_success:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            cursor.execute("SELECT cart FROM users WHERE email = ?", (email,))
            user = cursor.fetchone()
            conn.close()
            
            if user and user['cart']:
                try:
                    cart_data = json.loads(user['cart'])
                    print(f"[SUCCESS] Cart loaded from SQLite for {email}")
                except json.JSONDecodeError:
                    cart_data = []
                    print(f"[WARN] Invalid cart JSON in SQLite for {email}")
            
        return jsonify({
            'success': True,
            'cart': cart_data
        })
    except Exception as e:
        print(f"Error loading cart: {str(e)}")
        return jsonify({'success': False, 'message': 'Error loading cart'}), 500

# ==================== COUPON MANAGEMENT APIs ====================

@app.route('/api/admin/coupons', methods=['GET'])
def get_all_coupons():
    """Get all coupons for admin dashboard"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, code, discount_type, discount_value, min_order_value,
                   max_discount, usage_limit, used_count, expiry_date, is_active, created_at
            FROM coupons
            ORDER BY created_at DESC
        ''')
        coupons = [dict(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({'success': True, 'coupons': coupons})
    except Exception as e:
        print(f"Error fetching coupons: {str(e)}")
        return jsonify({'success': False, 'message': 'Error fetching coupons'}), 500

@app.route('/api/admin/coupons', methods=['POST'])
def create_coupon():
    """Create a new coupon"""
    try:
        data = request.json
        code = data.get('code', '').upper().strip()
        discount_type = data.get('discount_type')
        discount_value = data.get('discount_value')
        min_order_value = data.get('min_order_value', 0)
        max_discount = data.get('max_discount')
        usage_limit = data.get('usage_limit')
        expiry_date = data.get('expiry_date')
        
        if not all([code, discount_type, discount_value is not None]):
            return jsonify({'success': False, 'message': 'Missing required fields'}), 400
        
        if discount_type not in ['percentage', 'fixed']:
            return jsonify({'success': False, 'message': 'Invalid discount type'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO coupons (code, discount_type, discount_value, min_order_value,
                                max_discount, usage_limit, expiry_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (code, discount_type, discount_value, min_order_value,
              max_discount, usage_limit, expiry_date))
        conn.commit()
        coupon_id = cursor.lastrowid
        conn.close()
        
        return jsonify({'success': True, 'coupon_id': coupon_id, 'message': 'Coupon created successfully'})
    except sqlite3.IntegrityError:
        return jsonify({'success': False, 'message': 'Coupon code already exists'}), 400
    except Exception as e:
        print(f"Error creating coupon: {str(e)}")
        return jsonify({'success': False, 'message': 'Error creating coupon'}), 500

@app.route('/api/admin/coupons/<int:coupon_id>', methods=['PUT'])
def update_coupon(coupon_id):
    """Update an existing coupon"""
    try:
        data = request.json
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build update query dynamically based on provided fields
        update_fields = []
        values = []
        
        if 'code' in data:
            update_fields.append('code = ?')
            values.append(data['code'].upper().strip())
        if 'discount_type' in data:
            update_fields.append('discount_type = ?')
            values.append(data['discount_type'])
        if 'discount_value' in data:
            update_fields.append('discount_value = ?')
            values.append(data['discount_value'])
        if 'min_order_value' in data:
            update_fields.append('min_order_value = ?')
            values.append(data['min_order_value'])
        if 'max_discount' in data:
            update_fields.append('max_discount = ?')
            values.append(data['max_discount'])
        if 'usage_limit' in data:
            update_fields.append('usage_limit = ?')
            values.append(data['usage_limit'])
        if 'expiry_date' in data:
            update_fields.append('expiry_date = ?')
            values.append(data['expiry_date'])
        if 'is_active' in data:
            update_fields.append('is_active = ?')
            values.append(data['is_active'])
        
        if not update_fields:
            return jsonify({'success': False, 'message': 'No fields to update'}), 400
        
        values.append(coupon_id)
        query = f"UPDATE coupons SET {', '.join(update_fields)} WHERE id = ?"
        
        cursor.execute(query, values)
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Coupon updated successfully'})
    except Exception as e:
        print(f"Error updating coupon: {str(e)}")
        return jsonify({'success': False, 'message': 'Error updating coupon'}), 500

@app.route('/api/admin/coupons/<int:coupon_id>', methods=['DELETE'])
def delete_coupon(coupon_id):
    """Delete a coupon"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM coupons WHERE id = ?', (coupon_id,))
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Coupon deleted successfully'})
    except Exception as e:
        print(f"Error deleting coupon: {str(e)}")
        return jsonify({'success': False, 'message': 'Error deleting coupon'}), 500

@app.route('/api/coupons/validate', methods=['POST'])
def validate_coupon():
    """Validate coupon and calculate discount"""
    try:
        data = request.json
        code = data.get('code', '').upper().strip()
        cart_total = data.get('cart_total', 0)
        
        if not code:
            return jsonify({'success': False, 'message': 'Coupon code is required'}), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM coupons WHERE code = ?', (code,))
        coupon = cursor.fetchone()
        conn.close()
        
        if not coupon:
            return jsonify({'success': True, 'valid': False, 'message': 'Invalid coupon code'})
        
        # Convert to dict for easier access
        coupon_dict = dict(coupon)
        
        # Check if coupon is active
        if not coupon_dict['is_active']:
            return jsonify({'success': True, 'valid': False, 'message': 'This coupon is no longer active'})
        
        # Check expiry date
        if coupon_dict['expiry_date']:
            from datetime import datetime
            expiry = datetime.strptime(coupon_dict['expiry_date'], '%Y-%m-%d')
            if datetime.now() > expiry:
                return jsonify({'success': True, 'valid': False, 'message': 'This coupon has expired'})
        
        # Check usage limit
        if coupon_dict['usage_limit'] is not None:
            if coupon_dict['used_count'] >= coupon_dict['usage_limit']:
                return jsonify({'success': True, 'valid': False, 'message': 'This coupon has reached its usage limit'})
        
        # Check minimum order value
        if cart_total < coupon_dict['min_order_value']:
            return jsonify({
                'success': True,
                'valid': False,
                'message': f"Minimum order value of ₹{coupon_dict['min_order_value']} required"
            })
        
        # Calculate discount
        discount_amount = 0
        if coupon_dict['discount_type'] == 'percentage':
            discount_amount = (cart_total * coupon_dict['discount_value']) / 100
            # Apply max discount cap if set
            if coupon_dict['max_discount'] is not None:
                discount_amount = min(discount_amount, coupon_dict['max_discount'])
        elif coupon_dict['discount_type'] == 'fixed':
            discount_amount = min(coupon_dict['discount_value'], cart_total)
        
        final_amount = cart_total - discount_amount
        
        return jsonify({
            'success': True,
            'valid': True,
            'discount_amount': round(discount_amount, 2),
            'final_amount': round(final_amount, 2),
            'coupon': {
                'code': coupon_dict['code'],
                'discount_type': coupon_dict['discount_type'],
                'discount_value': coupon_dict['discount_value']
            }
        })
    except Exception as e:
        print(f"Error validating coupon: {str(e)}")
        return jsonify({'success': False, 'message': 'Error validating coupon'}), 500

# Settings APIs
@app.route('/api/settings/shipping', methods=['GET'])
def get_shipping_rate():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = 'shipping_rate_per_km'")
    row = cursor.fetchone()
    conn.close()
    
    rate = 5.0 # Default
    if row:
        try:
            rate = float(row['value'])
        except ValueError:
            pass
            
    return jsonify({'rate': rate})

@app.route('/api/settings/shipping', methods=['POST'])
def update_shipping_rate():
    data = request.json or {}
    rate = data.get('rate')
    
    if rate is None:
        return jsonify({'success': False, 'message': 'Rate is required'}), 400
        
    try:
        rate_val = float(rate)
        if rate_val < 0:
            return jsonify({'success': False, 'message': 'Rate cannot be negative'}), 400
    except ValueError:
        return jsonify({'success': False, 'message': 'Invalid rate value'}), 400
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", ('shipping_rate_per_km', str(rate_val)))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'message': 'Shipping rate updated', 'rate': rate_val})

if __name__ == '__main__':
    print("Starting Flask server...")
    print(f"E-commerce website running on {PUBLIC_APP_URL or 'http://localhost:5000'}")
    app.run(debug=True, port=5000)
