import pymysql

conn = pymysql.connect(host='localhost', user='portfolio_user', password='Babu@122', database='usdt_portfolio_tracker')

with conn.cursor() as cur:
    # Users table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(80) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    print('users table created')
    
    # Transactions table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            transaction_type ENUM('buy', 'sell') NOT NULL,
            usdt_amount DECIMAL(20, 8) NOT NULL,
            price_per_unit DECIMAL(20, 8) NOT NULL,
            date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            notes TEXT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_date (user_id, date)
        )
    """)
    print('transactions table created')
    
    # Portfolio table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS portfolio (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            total_usdt_held DECIMAL(20, 8) DEFAULT 0.00000000,
            total_invested_usd DECIMAL(20, 2) DEFAULT 0.00,
            average_buy_price DECIMAL(20, 8) DEFAULT 0.00000000,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    print('portfolio table created')
    
    # Price History table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            symbol VARCHAR(20) NOT NULL DEFAULT 'USDT',
            price_usd DECIMAL(20, 8) NOT NULL,
            volume_24h DECIMAL(30, 2) DEFAULT 0,
            market_cap DECIMAL(30, 2) DEFAULT 0,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_symbol_timestamp (symbol, timestamp)
        )
    """)
    print('price_history table created')
    
    # Index
    cur.execute("CREATE INDEX IF NOT EXISTS idx_portfolio_user ON portfolio(user_id)")
    print('index created')

conn.commit()
conn.close()
print('All tables created successfully!')