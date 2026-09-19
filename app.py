from flask import Flask, request, jsonify, render_template, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import os
from datetime import datetime, timedelta
from decimal import Decimal
import requests
import threading
import time
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)

# Configuration
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL',
    'postgresql+psycopg2://postgres:postgres@localhost:5432/usdt_portfolio_tracker'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['REMEMBER_COOKIE_SECURE'] = os.environ.get('REMEMBER_COOKIE_SECURE', 'False').lower() == 'true'
app.config['REMEMBER_COOKIE_HTTPONLY'] = True
app.config['REMEMBER_COOKIE_SAMESITE'] = 'Lax'
app.config['PRICE_UPDATER_RUNNING'] = False

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Please log in to access this page.'
login_manager.login_message_category = 'info'


# Models
class User(UserMixin, db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    transactions = db.relationship('Transaction', backref='user', lazy=True, cascade='all, delete-orphan')
    portfolio = db.relationship('Portfolio', backref='user', uselist=False, lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Transaction(db.Model):
    __tablename__ = 'transactions'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    transaction_type = db.Column(db.Enum('buy', 'sell', name='transaction_type'), nullable=False)
    usdt_amount = db.Column(db.Numeric(20, 8), nullable=False)
    price_per_unit = db.Column(db.Numeric(20, 8), nullable=False)
    date = db.Column(db.DateTime, default=datetime.utcnow)
    notes = db.Column(db.Text, nullable=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'transaction_type': self.transaction_type,
            'usdt_amount': float(self.usdt_amount),
            'price_per_unit': float(self.price_per_unit),
            'date': self.date.isoformat() if self.date else None,
            'notes': self.notes
        }
    
    @property
    def usd_value(self):
        return float(self.usdt_amount) * float(self.price_per_unit)


class Portfolio(db.Model):
    __tablename__ = 'portfolio'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), unique=True, nullable=False)
    total_usdt_held = db.Column(db.Numeric(20, 8), default=Decimal('0.00000000'))
    total_invested_usd = db.Column(db.Numeric(20, 2), default=Decimal('0.00'))
    average_buy_price = db.Column(db.Numeric(20, 8), default=Decimal('0.00000000'))
    # P/L fields (calculated on-the-fly, not stored)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'total_usdt_held': float(self.total_usdt_held),
            'total_invested_usd': float(self.total_invested_usd),
            'average_buy_price': float(self.average_buy_price),
            'last_updated': self.last_updated.isoformat() if self.last_updated else None
        }
    
    def to_dict_with_pl(self, current_price_usd=None):
        """Return portfolio data with P/L calculations."""
        base = self.to_dict()
        
        if current_price_usd is None:
            price_data = get_latest_price()
            current_price_usd = price_data.get('price_usd', 1.0)
        
        current_price = Decimal(str(current_price_usd))
        total_usdt = Decimal(str(self.total_usdt_held))
        total_invested = Decimal(str(self.total_invested_usd))
        
        current_value = total_usdt * current_price
        unrealized_pl = current_value - total_invested
        unrealized_pl_pct = (unrealized_pl / total_invested * 100) if total_invested > 0 else Decimal('0')
        
        base.update({
            'current_price_usd': float(current_price),
            'current_value_usd': float(current_value),
            'unrealized_pl_usd': float(unrealized_pl),
            'unrealized_pl_pct': float(unrealized_pl_pct),
            'is_profitable': unrealized_pl >= 0
        })
        return base


class PriceHistory(db.Model):
    __tablename__ = 'price_history'
    
    id = db.Column(db.Integer, primary_key=True)
    symbol = db.Column(db.String(20), nullable=False, default='USDT')
    price_usd = db.Column(db.Numeric(20, 8), nullable=False)
    volume_24h = db.Column(db.Numeric(30, 2), default=0)
    market_cap = db.Column(db.Numeric(30, 2), default=0)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'symbol': self.symbol,
            'price_usd': float(self.price_usd),
            'volume_24h': float(self.volume_24h),
            'market_cap': float(self.market_cap),
            'timestamp': self.timestamp.isoformat() if self.timestamp else None
        }


# CoinGecko API configuration
COINGECKO_API_URL = 'https://api.coingecko.com/api/v3'
USDT_COIN_ID = 'tether'


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


# Helper functions
def update_portfolio(user_id):
    """Recalculate and update portfolio for a user based on their transactions."""
    portfolio = Portfolio.query.filter_by(user_id=user_id).first()
    if not portfolio:
        portfolio = Portfolio(user_id=user_id)
        db.session.add(portfolio)
    
    transactions = Transaction.query.filter_by(user_id=user_id).all()
    
    total_usdt = Decimal('0')
    total_invested = Decimal('0')
    
    for txn in transactions:
        amount = Decimal(str(txn.usdt_amount))
        price = Decimal(str(txn.price_per_unit))
        usd_value = amount * price
        
        if txn.transaction_type == 'buy':
            total_usdt += amount
            total_invested += usd_value
        elif txn.transaction_type == 'sell':
            total_usdt -= amount
            total_invested -= usd_value
    
    portfolio.total_usdt_held = total_usdt
    portfolio.total_invested_usd = total_invested
    
    if total_usdt > 0:
        portfolio.average_buy_price = total_invested / total_usdt
    else:
        portfolio.average_buy_price = Decimal('0')
    
    db.session.commit()
    return portfolio


# Portfolio P/L Calculation Functions
def calculate_portfolio_pl(user_id, current_price_usd=None):
    """
    Calculate detailed P/L for a user's portfolio using FIFO cost basis.
    Returns dict with portfolio summary and transaction-level P/L.
    """
    if current_price_usd is None:
        price_data = get_latest_price()
        current_price_usd = price_data.get('price_usd', 1.0)
    
    current_price = Decimal(str(current_price_usd))
    
    # Get all transactions ordered by date
    transactions = Transaction.query.filter_by(user_id=user_id).order_by(Transaction.date.asc()).all()
    
    # FIFO lot tracking for accurate P/L
    lots = []  # List of (remaining_amount, buy_price, buy_date, transaction_id)
    total_realized_pl = Decimal('0')
    total_fees = Decimal('0')  # Placeholder for future fee support
    
    for txn in transactions:
        amount = Decimal(str(txn.usdt_amount))
        price = Decimal(str(txn.price_per_unit))
        
        if txn.transaction_type == 'buy':
            # Add new lot
            lots.append({
                'remaining': amount,
                'buy_price': price,
                'buy_date': txn.date,
                'txn_id': txn.id
            })
        elif txn.transaction_type == 'sell':
            # Match against earliest lots (FIFO)
            sell_amount = amount
            sell_price = price
            
            while sell_amount > 0 and lots:
                lot = lots[0]
                matched_amount = min(sell_amount, lot['remaining'])
                
                # Calculate realized P/L for this match
                cost_basis = matched_amount * lot['buy_price']
                proceeds = matched_amount * sell_price
                realized_pl = proceeds - cost_basis
                total_realized_pl += realized_pl
                
                # Update lot
                lot['remaining'] -= matched_amount
                sell_amount -= matched_amount
                
                # Remove exhausted lot
                if lot['remaining'] <= Decimal('0.00000001'):
                    lots.pop(0)
            
            # If we couldn't match all (selling more than owned), track as short
            if sell_amount > 0:
                # This shouldn't happen in normal operation, but handle gracefully
                pass
    
    # Calculate current holdings and unrealized P/L
    total_usdt_held = sum(Decimal(str(lot['remaining'])) for lot in lots)
    total_cost_basis = sum(Decimal(str(lot['remaining'])) * lot['buy_price'] for lot in lots)
    current_value = total_usdt_held * current_price
    unrealized_pl = current_value - total_cost_basis
    
    # Weighted average buy price
    avg_buy_price = (total_cost_basis / total_usdt_held) if total_usdt_held > 0 else Decimal('0')
    
    # Total invested (cost basis of current holdings + realized losses from sells)
    # This represents total cash deployed
    buy_transactions = [t for t in transactions if t.transaction_type == 'buy']
    sell_transactions = [t for t in transactions if t.transaction_type == 'sell']
    
    total_bought_usd = sum(Decimal(str(t.usdt_amount)) * Decimal(str(t.price_per_unit)) for t in buy_transactions)
    total_sold_usd = sum(Decimal(str(t.usdt_amount)) * Decimal(str(t.price_per_unit)) for t in sell_transactions)
    
    return {
        'current_price_usd': float(current_price),
        'total_usdt_held': float(total_usdt_held),
        'total_cost_basis': float(total_cost_basis),
        'current_value_usd': float(current_value),
        'unrealized_pl_usd': float(unrealized_pl),
        'unrealized_pl_pct': float((unrealized_pl / total_cost_basis * 100) if total_cost_basis > 0 else Decimal('0')),
        'realized_pl_usd': float(total_realized_pl),
        'total_pl_usd': float(unrealized_pl + total_realized_pl),
        'average_buy_price': float(avg_buy_price),
        'total_invested_usd': float(total_bought_usd),
        'total_withdrawn_usd': float(total_sold_usd),
        'net_invested_usd': float(total_bought_usd - total_sold_usd),
        'lot_count': len(lots),
        'lots': [
            {
                'amount': float(lot['remaining']),
                'buy_price': float(lot['buy_price']),
                'buy_date': lot['buy_date'].isoformat() if lot['buy_date'] else None,
                'current_value': float(Decimal(str(lot['remaining'])) * current_price),
                'unrealized_pl': float(Decimal(str(lot['remaining'])) * (current_price - lot['buy_price'])),
                'unrealized_pl_pct': float((current_price - lot['buy_price']) / lot['buy_price'] * 100)
            }
            for lot in lots
        ]
    }


def get_transaction_history_with_pl(user_id, current_price_usd=None):
    """Get all transactions with P/L calculations for each."""
    if current_price_usd is None:
        price_data = get_latest_price()
        current_price_usd = price_data.get('price_usd', 1.0)
    
    current_price = Decimal(str(current_price_usd))
    transactions = Transaction.query.filter_by(user_id=user_id).order_by(Transaction.date.desc()).all()
    
    result = []
    for txn in transactions:
        txn_dict = txn.to_dict()
        amount = Decimal(str(txn.usdt_amount))
        price = Decimal(str(txn.price_per_unit))
        usd_value = amount * price
        
        if txn.transaction_type == 'buy':
            txn_dict['current_value'] = float(amount * current_price)
            txn_dict['unrealized_pl'] = float(amount * (current_price - price))
            txn_dict['unrealized_pl_pct'] = float((current_price - price) / price * 100) if price > 0 else 0
        else:
            txn_dict['current_value'] = float(usd_value)
            txn_dict['unrealized_pl'] = 0
            txn_dict['unrealized_pl_pct'] = 0
        
        result.append(txn_dict)
    
    return result


# Price Tracking Functions
def fetch_usdt_price():
    """Fetch current USDT price from CoinGecko API."""
    try:
        url = f'{COINGECKO_API_URL}/simple/price'
        params = {
            'ids': USDT_COIN_ID,
            'vs_currencies': 'usd',
            'include_24hr_vol': 'true',
            'include_market_cap': 'true',
            'include_last_updated_at': 'true'
        }
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if USDT_COIN_ID in data:
            usdt_data = data[USDT_COIN_ID]
            return {
                'price_usd': usdt_data.get('usd', 1.0),
                'volume_24h': usdt_data.get('usd_24h_vol', 0),
                'market_cap': usdt_data.get('usd_market_cap', 0),
                'last_updated': usdt_data.get('last_updated_at', int(time.time()))
            }
    except Exception as e:
        app.logger.error(f'Error fetching USDT price: {e}')
    
    return None


def save_price_history(price_data):
    """Save price data to database."""
    if not price_data:
        return None
    
    try:
        price_record = PriceHistory(
            symbol='USDT',
            price_usd=Decimal(str(price_data['price_usd'])),
            volume_24h=Decimal(str(price_data['volume_24h'])),
            market_cap=Decimal(str(price_data['market_cap']))
        )
        db.session.add(price_record)
        db.session.commit()
        return price_record
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Error saving price history: {e}')
        return None


def fetch_and_store_price():
    """Fetch and store current price - can be called by scheduler."""
    price_data = fetch_usdt_price()
    if price_data:
        return save_price_history(price_data)
    return None


def get_historical_prices(days=7, interval_hours=1):
    """Get historical price data from database."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    # Get all records in time range
    records = PriceHistory.query.filter(
        PriceHistory.symbol == 'USDT',
        PriceHistory.timestamp >= cutoff
    ).order_by(PriceHistory.timestamp.asc()).all()
    
    # If we need to downsample for charts, we can do it here
    if interval_hours > 1 and len(records) > 500:
        # Simple downsampling - take every nth record
        step = max(1, len(records) // 500)
        records = records[::step]
    
    return [r.to_dict() for r in records]


def get_latest_price():
    """Get the most recent price from database or fetch fresh."""
    latest = PriceHistory.query.filter_by(symbol='USDT').order_by(PriceHistory.timestamp.desc()).first()
    
    # Refresh more frequently for a noticeably more responsive live tracker.
    if not latest or (datetime.utcnow() - latest.timestamp).total_seconds() > 60:
        price_data = fetch_usdt_price()
        if price_data:
            latest = save_price_history(price_data)
    
    return latest.to_dict() if latest else {'price_usd': 1.0, 'volume_24h': 0, 'market_cap': 0, 'timestamp': datetime.utcnow().isoformat()}


# Background price updater
def start_price_updater():
    """Start background thread to periodically update price."""
    if app.config.get('PRICE_UPDATER_RUNNING'):
        return None

    def updater():
        while True:
            try:
                with app.app_context():
                    fetch_and_store_price()
            except Exception as e:
                app.logger.error(f'Price updater error: {e}')
            time.sleep(15)  # Update every 15 seconds for a more live feel

    thread = threading.Thread(target=updater, daemon=True)
    thread.start()
    app.config['PRICE_UPDATER_RUNNING'] = True
    return thread


def init_app():
    """Initialize the app for both local and production environments."""
    with app.app_context():
        db.create_all()
        start_price_updater()


# Initialize database tables on first request (lazy initialization)
_tables_created = False

def ensure_tables():
    """Create database tables on first request if they don't exist."""
    global _tables_created
    if not _tables_created:
        with app.app_context():
            try:
                db.create_all()
                _tables_created = True
            except Exception as e:
                app.logger.error(f"Failed to create tables: {e}")
                raise


@app.before_request
def create_tables_on_first_request():
    """Ensure database tables exist before handling any request."""
    ensure_tables()


# Start background price updater
start_price_updater()


# Template Routes
@app.route('/')
def index():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    return redirect(url_for('login'))


@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        confirm_password = request.form.get('confirm_password', '')
        
        if not username or not password:
            flash('Username and password are required.', 'error')
        elif password != confirm_password:
            flash('Passwords do not match.', 'error')
        elif len(password) < 8:
            flash('Password must be at least 8 characters.', 'error')
        elif User.query.filter_by(username=username).first():
            flash('Username already exists.', 'error')
        else:
            user = User(username=username)
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            
            portfolio = Portfolio(user_id=user.id)
            db.session.add(portfolio)
            db.session.commit()
            
            flash('Account created successfully! Please log in.', 'success')
            return redirect(url_for('login'))
    
    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        remember = bool(request.form.get('remember'))
        
        if not username or not password:
            flash('Username and password are required.', 'error')
        else:
            user = User.query.filter_by(username=username).first()
            if user and user.check_password(password):
                login_user(user, remember=remember)
                next_page = request.args.get('next')
                flash(f'Welcome back, {user.username}!', 'success')
                return redirect(next_page or url_for('dashboard'))
            else:
                flash('Invalid username or password.', 'error')
    
    return render_template('login.html')


@app.route('/logout')
@login_required
def logout():
    username = current_user.username
    logout_user()
    flash(f'Goodbye, {username}! You have been logged out.', 'info')
    return redirect(url_for('login'))


@app.route('/dashboard')
@login_required
def dashboard():
    portfolio = Portfolio.query.filter_by(user_id=current_user.id).first()
    recent_transactions = Transaction.query.filter_by(user_id=current_user.id).order_by(Transaction.date.desc()).limit(5).all()
    transaction_count = Transaction.query.filter_by(user_id=current_user.id).count()
    
    # Calculate P/L for dashboard
    pl_data = calculate_portfolio_pl(current_user.id) if portfolio else None
    
    return render_template('dashboard.html', 
                         portfolio=portfolio, 
                         recent_transactions=recent_transactions,
                         transaction_count=transaction_count,
                         pl_data=pl_data)


@app.route('/portfolio')
@login_required
def portfolio():
    portfolio = Portfolio.query.filter_by(user_id=current_user.id).first()
    pl_data = calculate_portfolio_pl(current_user.id) if portfolio else None
    return render_template('portfolio.html', portfolio=portfolio, pl_data=pl_data)


@app.route('/transactions')
@login_required
def transactions():
    transactions = Transaction.query.filter_by(user_id=current_user.id).order_by(Transaction.date.desc()).all()
    return render_template('transactions.html', transactions=transactions)


@app.route('/transactions/add', methods=['POST'])
@login_required
def add_transaction():
    transaction_type = request.form.get('transaction_type')
    usdt_amount = request.form.get('usdt_amount')
    price_per_unit = request.form.get('price_per_unit')
    date_str = request.form.get('date')
    notes = request.form.get('notes', '').strip()
    
    if not transaction_type or not usdt_amount or not price_per_unit:
        flash('All fields are required.', 'error')
        return redirect(url_for('transactions'))
    
    if transaction_type not in ('buy', 'sell'):
        flash('Invalid transaction type.', 'error')
        return redirect(url_for('transactions'))
    
    try:
        usdt_amount = Decimal(usdt_amount)
        price_per_unit = Decimal(price_per_unit)
        
        if usdt_amount <= 0 or price_per_unit <= 0:
            flash('Amount and price must be greater than zero.', 'error')
            return redirect(url_for('transactions'))
    except:
        flash('Invalid amount or price format.', 'error')
        return redirect(url_for('transactions'))
    
    # Parse date if provided
    transaction_date = datetime.utcnow()
    if date_str:
        try:
            transaction_date = datetime.fromisoformat(date_str)
        except:
            pass  # Use current time if invalid
    
    transaction = Transaction(
        user_id=current_user.id,
        transaction_type=transaction_type,
        usdt_amount=usdt_amount,
        price_per_unit=price_per_unit,
        date=transaction_date,
        notes=notes if notes else None
    )
    db.session.add(transaction)
    db.session.commit()
    
    update_portfolio(current_user.id)
    flash('Transaction added successfully!', 'success')
    return redirect(url_for('transactions'))


@app.route('/transactions/delete/<int:transaction_id>', methods=['POST'])
@login_required
def delete_transaction(transaction_id):
    transaction = Transaction.query.filter_by(id=transaction_id, user_id=current_user.id).first()
    if not transaction:
        flash('Transaction not found.', 'error')
        return redirect(url_for('transactions'))
    
    db.session.delete(transaction)
    db.session.commit()
    
    update_portfolio(current_user.id)
    flash('Transaction deleted successfully!', 'success')
    return redirect(url_for('transactions'))


@app.route('/profile', methods=['GET', 'POST'])
@login_required
def profile():
    if request.method == 'POST':
        current_password = request.form.get('current_password')
        new_password = request.form.get('new_password')
        confirm_new_password = request.form.get('confirm_new_password')
        
        if not current_password or not new_password or not confirm_new_password:
            flash('All fields are required.', 'error')
        elif not current_user.check_password(current_password):
            flash('Current password is incorrect.', 'error')
        elif new_password != confirm_new_password:
            flash('New passwords do not match.', 'error')
        elif len(new_password) < 8:
            flash('New password must be at least 8 characters.', 'error')
        else:
            current_user.set_password(new_password)
            db.session.commit()
            flash('Password updated successfully!', 'success')
    
    return render_template('profile.html')


@app.route('/profile/change-password', methods=['POST'])
@login_required
def change_password():
    current_password = request.form.get('current_password')
    new_password = request.form.get('new_password')
    confirm_new_password = request.form.get('confirm_new_password')
    
    if not current_password or not new_password or not confirm_new_password:
        flash('All fields are required.', 'error')
    elif not current_user.check_password(current_password):
        flash('Current password is incorrect.', 'error')
    elif new_password != confirm_new_password:
        flash('New passwords do not match.', 'error')
    elif len(new_password) < 8:
        flash('New password must be at least 8 characters.', 'error')
    else:
        current_user.set_password(new_password)
        db.session.commit()
        flash('Password updated successfully!', 'success')
    
    return redirect(url_for('profile'))


@app.route('/profile/delete', methods=['POST'])
@login_required
def delete_account():
    user_id = current_user.id
    username = current_user.username
    
    logout_user()
    
    user = User.query.get(user_id)
    if user:
        db.session.delete(user)
        db.session.commit()
        flash(f'Account "{username}" has been permanently deleted.', 'info')
    
    return redirect(url_for('register'))


# API Routes (JSON)
@app.route('/api/register', methods=['POST'])
def api_register():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Username and password required'}), 400
    
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Username already exists'}), 409
    
    user = User(username=data['username'])
    user.set_password(data['password'])
    db.session.add(user)
    db.session.commit()
    
    portfolio = Portfolio(user_id=user.id)
    db.session.add(portfolio)
    db.session.commit()
    
    return jsonify({'message': 'User registered successfully', 'user': user.to_dict()}), 201


@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Username and password required'}), 400
    
    user = User.query.filter_by(username=data['username']).first()
    if not user or not user.check_password(data['password']):
        return jsonify({'error': 'Invalid credentials'}), 401
    
    login_user(user, remember=data.get('remember', False))
    return jsonify({'message': 'Login successful', 'user': user.to_dict()})


@app.route('/api/logout', methods=['POST'])
@login_required
def api_logout():
    logout_user()
    return jsonify({'message': 'Logged out successfully'})


@app.route('/api/user', methods=['GET'])
@login_required
def api_get_user():
    return jsonify(current_user.to_dict())


@app.route('/api/transactions', methods=['GET'])
@login_required
def api_get_transactions():
    transactions = Transaction.query.filter_by(user_id=current_user.id).order_by(Transaction.date.desc()).all()
    return jsonify([t.to_dict() for t in transactions])


@app.route('/api/transactions', methods=['POST'])
@login_required
def api_create_transaction():
    data = request.get_json()
    required_fields = ['transaction_type', 'usdt_amount', 'price_per_unit']
    if not data or not all(field in data for field in required_fields):
        return jsonify({'error': 'Missing required fields'}), 400
    
    if data['transaction_type'] not in ('buy', 'sell'):
        return jsonify({'error': 'transaction_type must be buy or sell'}), 400
    
    # Parse date if provided
    transaction_date = datetime.utcnow()
    if data.get('date'):
        try:
            transaction_date = datetime.fromisoformat(data['date'].replace('Z', '+00:00'))
        except:
            pass
    
    transaction = Transaction(
        user_id=current_user.id,
        transaction_type=data['transaction_type'],
        usdt_amount=data['usdt_amount'],
        price_per_unit=data['price_per_unit'],
        date=transaction_date,
        notes=data.get('notes')
    )
    db.session.add(transaction)
    db.session.commit()
    
    update_portfolio(current_user.id)
    
    return jsonify(transaction.to_dict()), 201


@app.route('/api/transactions/<int:transaction_id>', methods=['DELETE'])
@login_required
def api_delete_transaction(transaction_id):
    transaction = Transaction.query.filter_by(id=transaction_id, user_id=current_user.id).first()
    if not transaction:
        return jsonify({'error': 'Transaction not found'}), 404
    
    db.session.delete(transaction)
    db.session.commit()
    
    update_portfolio(current_user.id)
    
    return jsonify({'message': 'Transaction deleted successfully'})


# Enhanced Portfolio & Transaction API Routes
@app.route('/api/portfolio/pl', methods=['GET'])
@login_required
def api_portfolio_pl():
    """Get detailed P/L breakdown for portfolio."""
    pl_data = calculate_portfolio_pl(current_user.id)
    return jsonify(pl_data)


@app.route('/api/transactions/history', methods=['GET'])
@login_required
def api_transaction_history():
    """Get all transactions with P/L calculations."""
    transactions = get_transaction_history_with_pl(current_user.id)
    return jsonify(transactions)


@app.route('/api/portfolio/summary', methods=['GET'])
@login_required
def api_portfolio_summary():
    """Get portfolio summary with key metrics."""
    pl_data = calculate_portfolio_pl(current_user.id)
    portfolio = Portfolio.query.filter_by(user_id=current_user.id).first()
    
    return jsonify({
        'portfolio_id': portfolio.id if portfolio else None,
        'holdings': {
            'usdt': pl_data['total_usdt_held'],
            'value_usd': pl_data['current_value_usd'],
            'cost_basis': pl_data['total_cost_basis'],
            'avg_buy_price': pl_data['average_buy_price'],
            'current_price': pl_data['current_price_usd']
        },
        'performance': {
            'unrealized_pl_usd': pl_data['unrealized_pl_usd'],
            'unrealized_pl_pct': pl_data['unrealized_pl_pct'],
            'realized_pl_usd': pl_data['realized_pl_usd'],
            'total_pl_usd': pl_data['total_pl_usd'],
            'is_profitable': pl_data['unrealized_pl_usd'] >= 0
        },
        'cash_flow': {
            'total_invested': pl_data['total_invested_usd'],
            'total_withdrawn': pl_data['total_withdrawn_usd'],
            'net_invested': pl_data['net_invested_usd']
        },
        'lots': pl_data['lots']
    })


@app.route('/api/portfolio', methods=['GET'])
@login_required
def api_get_portfolio():
    portfolio = Portfolio.query.filter_by(user_id=current_user.id).first()
    if not portfolio:
        return jsonify({'error': 'Portfolio not found'}), 404
    
    # Include P/L calculations
    pl_data = calculate_portfolio_pl(current_user.id)
    result = portfolio.to_dict()
    result.update(pl_data)
    
    return jsonify(result)


@app.route('/api/portfolio/refresh', methods=['POST'])
@login_required
def api_refresh_portfolio():
    portfolio = update_portfolio(current_user.id)
    pl_data = calculate_portfolio_pl(current_user.id)
    result = portfolio.to_dict()
    result.update(pl_data)
    return jsonify(result)


# Price Tracking API Routes
@app.route('/api/price/current', methods=['GET'])
def api_current_price():
    """Get current USDT price."""
    price_data = get_latest_price()
    return jsonify({
        'symbol': 'USDT',
        'price_usd': price_data['price_usd'],
        'volume_24h': price_data['volume_24h'],
        'market_cap': price_data['market_cap'],
        'timestamp': price_data['timestamp']
    })


@app.route('/api/price/history', methods=['GET'])
def api_price_history():
    """Get historical USDT price data."""
    days = request.args.get('days', 7, type=int)
    days = max(1, min(days, 90))  # Limit to 1-90 days
    
    interval = request.args.get('interval', 1, type=int)
    interval = max(1, min(interval, 24))
    
    history = get_historical_prices(days=days, interval_hours=interval)
    
    return jsonify({
        'symbol': 'USDT',
        'days': days,
        'interval_hours': interval,
        'data': history
    })


@app.route('/api/price/refresh', methods=['POST'])
def api_refresh_price():
    """Manually trigger price fetch and store."""
    price_record = fetch_and_store_price()
    if price_record:
        return jsonify(price_record.to_dict())
    return jsonify({'error': 'Failed to fetch price'}), 500


@app.route('/price')
@login_required
def price_tracker():
    """Price tracking page with live updates and charts."""
    return render_template('price.html')


# Error handlers
@app.errorhandler(404)
def not_found(error):
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Not found'}), 404
    return render_template('404.html'), 404


@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    if request.path.startswith('/api/'):
        return jsonify({'error': 'Internal server error'}), 500
    return render_template('500.html'), 500


if __name__ == '__main__':
    init_app()
    app.run(debug=False, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))