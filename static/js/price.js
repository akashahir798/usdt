// USDT Price Tracker JavaScript
class PriceTracker {
    constructor() {
        this.currentPrice = null;
        this.priceHistory = [];
        this.chart = null;
        this.autoRefreshInterval = null;
        this.autoRefreshEnabled = true;
        this.refreshIntervalMs = 30000; // 30 seconds (was 10000)
        this.currentTimeframe = 7;
        this.currentChartType = 'line';
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        document.addEventListener('currency:changed', () => {
            if (this.currentPrice) {
                this.updatePriceDisplay(this.currentPrice);
            }
            this.updatePortfolioValue();
        });
        this.fetchCurrentPrice();
        this.fetchPriceHistory(this.currentTimeframe);
        this.updatePortfolioValue();
        this.startAutoRefresh();
        
        // Request notification permission
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
    
    bindEvents() {
        // Timeframe buttons
        document.querySelectorAll('input[name="timeframe"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.currentTimeframe = parseInt(e.target.value);
                    this.fetchPriceHistory(this.currentTimeframe);
                }
            });
        });
        
        // Alert form
        const alertForm = document.getElementById('alertForm');
        if (alertForm) {
            alertForm.addEventListener('submit', (e) => this.handleAlertSubmit(e));
        }
    }
    
    async fetchCurrentPrice() {
        try {
            const response = await fetch('/api/price/current');
            const data = await response.json();
            
            if (data.price_usd !== undefined) {
                this.currentPrice = data;
                this.updatePriceDisplay(data);
                this.updatePortfolioValue();
                this.checkPriceAlerts(data.price_usd);
            }
        } catch (error) {
            console.error('Error fetching current price:', error);
            this.showError('Failed to fetch current price');
        }
    }
    
    async fetchPriceHistory(days) {
        try {
            const response = await fetch(`/api/price/history?days=${days}&interval=1`);
            const data = await response.json();
            
            if (data.data) {
                this.priceHistory = data.data;
                this.renderChart();
                this.renderPriceTable();
                this.updateChartInfo(days);
            }
        } catch (error) {
            console.error('Error fetching price history:', error);
            this.showError('Failed to fetch price history');
        }
    }
    
    updatePriceDisplay(data) {
        const currencyManager = window.currencyManager || null;
        const priceEl = document.getElementById('currentPrice');
        const timestampEl = document.getElementById('priceTimestamp');
        const volumeEl = document.getElementById('volume24h');
        const marketCapEl = document.getElementById('marketCap');
        const lastUpdateEl = document.getElementById('lastUpdate');
        const changeEl = document.getElementById('priceChange');
        const changeValueEl = document.getElementById('changeValue');
        const changeLabelEl = document.getElementById('changeLabel');
        
        if (priceEl) {
            priceEl.textContent = currencyManager ? currencyManager.formatMoney(data.price_usd) : '$' + data.price_usd.toFixed(4);
            
            // Animate price change
            priceEl.classList.remove('text-success', 'text-danger');
            if (this.lastPrice !== undefined) {
                if (data.price_usd > this.lastPrice) {
                    priceEl.classList.add('text-success');
                } else if (data.price_usd < this.lastPrice) {
                    priceEl.classList.add('text-danger');
                }
            }
            this.lastPrice = data.price_usd;
        }
        
        if (timestampEl && data.timestamp) {
            const date = new Date(data.timestamp * 1000);
            timestampEl.textContent = 'Updated: ' + date.toLocaleString();
        }
        
        if (volumeEl) {
            volumeEl.textContent = currencyManager ? currencyManager.formatMoney(data.volume_24h) : this.formatNumber(data.volume_24h);
        }
        
        if (marketCapEl) {
            marketCapEl.textContent = currencyManager ? currencyManager.formatMoney(data.market_cap) : this.formatNumber(data.market_cap);
        }
        
        if (lastUpdateEl && data.timestamp) {
            const date = new Date(data.timestamp * 1000);
            lastUpdateEl.textContent = date.toLocaleTimeString();
        }
        
        // Calculate 24h change from history
        if (this.priceHistory.length > 1) {
            const oldest = this.priceHistory[0];
            const latest = this.priceHistory[this.priceHistory.length - 1];
            const changePct = ((latest.price_usd - oldest.price_usd) / oldest.price_usd) * 100;
            
            if (changeValueEl) {
                changeValueEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
                changeValueEl.className = 'fw-bold ' + (changePct >= 0 ? 'text-success' : 'text-danger');
            }
            if (changeLabelEl) {
                changeLabelEl.textContent = '24h';
            }
            if (changeEl) {
                changeEl.className = 'px-3 py-2 rounded ' + (changePct >= 0 ? 'bg-success bg-opacity-10' : 'bg-danger bg-opacity-10');
            }
        }
    }
    
    updatePortfolioValue() {
        // Fetch user's portfolio to calculate live value
        fetch('/api/portfolio')
            .then(res => res.json())
            .then(data => {
                if (data.total_usdt_held && this.currentPrice) {
                    const usdtHeld = parseFloat(data.total_usdt_held);
                    const invested = parseFloat(data.total_invested_usd) || 0;
                    const currentValue = usdtHeld * this.currentPrice.price_usd;
                    const pnl = currentValue - invested;
                    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
                    const currencyManager = window.currencyManager || null;
                    
                    const portfolioValueEl = document.getElementById('portfolioValue');
                    const portfolioUSDTEl = document.getElementById('portfolioUSDT');
                    const unrealizedPnlEl = document.getElementById('unrealizedPnl');
                    const unrealizedPnlPctEl = document.getElementById('unrealizedPnlPct');
                    
                    if (portfolioValueEl) {
                        portfolioValueEl.textContent = currencyManager ? currencyManager.formatMoney(currentValue) : '$' + currentValue.toFixed(2);
                    }
                    if (portfolioUSDTEl) {
                        portfolioUSDTEl.textContent = usdtHeld.toFixed(8) + ' USDT';
                    }
                    if (unrealizedPnlEl) {
                        unrealizedPnlEl.textContent = currencyManager ? currencyManager.formatSignedMoney(pnl) : (pnl >= 0 ? '+' : '') + '$' + Math.abs(pnl).toFixed(2);
                        unrealizedPnlEl.className = 'fw-bold ' + (pnl >= 0 ? 'text-success' : 'text-danger');
                    }
                    if (unrealizedPnlPctEl) {
                        unrealizedPnlPctEl.textContent = currencyManager ? currencyManager.formatSignedPercent(pnlPct) : (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%';
                        unrealizedPnlPctEl.className = 'text-muted ' + (pnlPct >= 0 ? 'text-success' : 'text-danger');
                    }
                }
            })
            .catch(err => console.error('Error fetching portfolio:', err));
    }
    
    renderChart() {
        const ctx = document.getElementById('priceChart');
        if (!ctx) return;
        
        const labels = this.priceHistory.map(d => new Date(d.timestamp).toLocaleString());
        const prices = this.priceHistory.map(d => d.price_usd);
        
        const datasets = [{
            label: 'USDT Price (USD)',
            data: prices,
            borderColor: 'rgb(13, 110, 253)',
            backgroundColor: this.currentChartType === 'area' ? 'rgba(13, 110, 253, 0.1)' : 'transparent',
            fill: this.currentChartType === 'area',
            tension: 0.2,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2
        }];
        
        if (this.chart) {
            this.chart.data.labels = labels;
            this.chart.data.datasets = datasets;
            this.chart.options.plugins.fill = this.currentChartType === 'area';
            this.chart.update();
        } else {
            this.chart = new Chart(ctx, {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            padding: 12,
                            titleFont: { size: 13 },
                            bodyFont: { size: 12 },
                            callbacks: {
                                label: (context) => `$${context.parsed.y.toFixed(4)}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            ticks: {
                                maxTicksLimit: 10,
                                callback: function(value, index) {
                                    const label = this.getLabelForValue(value);
                                    return new Date(label).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                }
                            }
                        },
                        y: {
                            grid: { color: 'rgba(0, 0, 0, 0.05)' },
                            ticks: {
                                callback: (value) => '$' + value.toFixed(4),
                                stepSize: 0.001
                            },
                            // Don't force zero for stablecoins
                            beginAtZero: false
                        }
                    },
                    animation: {
                        duration: 300
                    }
                }
            });
        }
    }
    
    toggleChartType(type) {
        this.currentChartType = type;
        if (this.chart) {
            this.chart.data.datasets[0].fill = type === 'area';
            this.chart.data.datasets[0].backgroundColor = type === 'area' ? 'rgba(13, 110, 253, 0.1)' : 'transparent';
            this.chart.update();
        }
        
        // Update button states
        document.querySelectorAll('.btn-group button').forEach(btn => {
            btn.classList.remove('active');
            if (btn.textContent.includes(type === 'line' ? 'Line' : 'Area')) {
                btn.classList.add('active');
            }
        });
    }
    
    renderPriceTable() {
        const tbody = document.getElementById('priceTableBody');
        if (!tbody) return;
        
        // Show last 50 entries, most recent first
        const recent = [...this.priceHistory].reverse().slice(0, 50);
        
        if (recent.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">No price data available</td></tr>';
            return;
        }
        
        tbody.innerHTML = recent.map(d => {
            const date = new Date(d.timestamp);
            return `
                <tr>
                    <td>${date.toISOString().replace('T', ' ').substring(0, 19)}</td>
                    <td class="fw-monospace">$${d.price_usd.toFixed(6)}</td>
                    <td class="fw-monospace">${this.formatNumber(d.volume_24h)}</td>
                    <td class="fw-monospace">${this.formatNumber(d.market_cap)}</td>
                </tr>
            `;
        }).join('');
    }
    
    updateChartInfo(days) {
        const infoEl = document.getElementById('chartInfo');
        if (infoEl) {
            const intervals = { 1: 'hourly', 7: 'hourly', 30: '4-hourly', 90: 'daily' };
            infoEl.textContent = `Showing ${days} day${days > 1 ? 's' : ''} of ${intervals[days] || 'hourly'} data (${this.priceHistory.length} points)`;
        }
    }
    
    toggleAutoRefresh() {
        this.autoRefreshEnabled = !this.autoRefreshEnabled;
        const btn = document.getElementById('autoRefreshBtn');
        const text = document.getElementById('autoRefreshText');
        
        if (this.autoRefreshEnabled) {
            btn.classList.remove('btn-outline-primary');
            btn.classList.add('btn-primary');
            text.textContent = 'Stop Auto Refresh';
            this.startAutoRefresh();
        } else {
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-outline-primary');
            text.textContent = 'Auto Refresh';
            this.stopAutoRefresh();
        }
    }
    
    startAutoRefresh() {
        this.stopAutoRefresh();
        this.autoRefreshInterval = setInterval(() => {
            if (this.autoRefreshEnabled && document.visibilityState !== 'hidden') {
                this.fetchCurrentPrice();
                this.updatePortfolioValue();
            }
        }, this.refreshIntervalMs);
    }
    
    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }
    
    handleAlertSubmit(e) {
        e.preventDefault();
        
        const type = document.getElementById('alertType').value;
        const price = parseFloat(document.getElementById('alertPrice').value);
        const method = document.getElementById('alertEmail').value;
        
        if (isNaN(price) || price <= 0) {
            alert('Please enter a valid price');
            return;
        }
        
        // Store alert in localStorage
        const alerts = JSON.parse(localStorage.getItem('usdt_price_alerts') || '[]');
        alerts.push({
            id: Date.now(),
            type,
            price,
            method,
            created: new Date().toISOString(),
            triggered: false
        });
        localStorage.setItem('usdt_price_alerts', JSON.stringify(alerts));
        
        this.updateAlertStatus();
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('alertModal'));
        if (modal) modal.hide();
        
        // Reset form
        e.target.reset();
    }
    
    checkPriceAlerts(currentPrice) {
        const alerts = JSON.parse(localStorage.getItem('usdt_price_alerts') || '[]');
        const activeAlerts = alerts.filter(a => !a.triggered);
        
        activeAlerts.forEach(alert => {
            let triggered = false;
            if (alert.type === 'above' && currentPrice >= alert.price) {
                triggered = true;
            } else if (alert.type === 'below' && currentPrice <= alert.price) {
                triggered = true;
            }
            
            if (triggered) {
                alert.triggered = true;
                this.showNotification(alert, currentPrice);
            }
        });
        
        localStorage.setItem('usdt_price_alerts', JSON.stringify(alerts));
        this.updateAlertStatus();
    }
    
    showNotification(alert, currentPrice) {
        const message = `USDT price ${alert.type === 'above' ? 'rose above' : 'fell below'} $${alert.price.toFixed(4)} (current: $${currentPrice.toFixed(4)})`;
        
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('USDT Price Alert', {
                body: message,
                icon: '/static/favicon.ico'
            });
        }
        
        // Also show in-page alert
        this.showToast(message, 'warning');
    }
    
    updateAlertStatus() {
        const alerts = JSON.parse(localStorage.getItem('usdt_price_alerts') || '[]');
        const active = alerts.filter(a => !a.triggered);
        const statusEl = document.getElementById('alertStatus');
        
        if (statusEl) {
            if (active.length === 0) {
                statusEl.textContent = 'No active alerts';
                statusEl.className = 'text-muted';
            } else {
                statusEl.textContent = `${active.length} active alert${active.length > 1 ? 's' : ''}`;
                statusEl.className = 'text-primary';
            }
        }
    }
    
    showToast(message, type = 'info') {
        const toastContainer = this.getOrCreateToastContainer();
        const toastEl = document.createElement('div');
        toastEl.className = `toast align-items-center text-white bg-${type} border-0`;
        toastEl.setAttribute('role', 'alert');
        toastEl.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        `;
        toastContainer.appendChild(toastEl);
        const toast = new bootstrap.Toast(toastEl, { delay: 5000 });
        toast.show();
        toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
    }
    
    getOrCreateToastContainer() {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
            container.style.zIndex = '9999';
            document.body.appendChild(container);
        }
        return container;
    }
    
    showError(message) {
        this.showToast(message, 'danger');
    }
    
    formatNumber(num) {
        if (num >= 1e12) return '$' + (num / 1e12).toFixed(2) + 'T';
        if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
        return '$' + num.toFixed(2);
    }
    
    exportPriceData() {
        const data = {
            symbol: 'USDT',
            current_price: this.currentPrice,
            history: this.priceHistory,
            exported_at: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `usdt_price_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// Global functions for inline onclick handlers
function fetchCurrentPrice() {
    if (window.priceTracker) {
        window.priceTracker.fetchCurrentPrice();
    }
}

function toggleAutoRefresh() {
    if (window.priceTracker) {
        window.priceTracker.toggleAutoRefresh();
    }
}

function toggleChartType(type) {
    if (window.priceTracker) {
        window.priceTracker.toggleChartType(type);
    }
}

function exportPriceData() {
    if (window.priceTracker) {
        window.priceTracker.exportPriceData();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.priceTracker = new PriceTracker();
});