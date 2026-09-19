-- Database Schema for USDT Portfolio Tracker
-- Run this script to create the database and tables

CREATE DATABASE IF NOT EXISTS usdt_portfolio_tracker;
USE usdt_portfolio_tracker;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
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
);

-- Portfolio table (aggregate holdings per user)
CREATE TABLE IF NOT EXISTS portfolio (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    total_usdt_held DECIMAL(20, 8) DEFAULT 0.00000000,
    total_invested_usd DECIMAL(20, 2) DEFAULT 0.00,
    average_buy_price DECIMAL(20, 8) DEFAULT 0.00000000,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Price History table (for charts and historical data)
CREATE TABLE IF NOT EXISTS price_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL DEFAULT 'USDT',
    price_usd DECIMAL(20, 8) NOT NULL,
    volume_24h DECIMAL(30, 2) DEFAULT 0,
    market_cap DECIMAL(30, 2) DEFAULT 0,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_symbol_timestamp (symbol, timestamp)
);

-- Optional: Index for faster portfolio lookups
CREATE INDEX idx_portfolio_user ON portfolio(user_id);