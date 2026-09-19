// Dashboard JavaScript with Chart.js integration
class DashboardManager {
    constructor() {
        this.portfolioChart = null;
        this.chartType = 'area'; // 'area' or 'line'
        this.chartPeriod = 7;
        this.plData = null;
        this.transactions = [];
        this.priceHistory = [];
        this.refreshInterval = null;
        this.autoRefreshEnabled = true;
        this.refreshIntervalMs = 30000; // 30 seconds
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.loadInitialData();
        this.startAutoRefresh();
    }
    
    bindEvents() {
        // Chart period buttons
        document.querySelectorAll('input[name="chartPeriod"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.chartPeriod = e.target.value === 'all' ? 'all' : parseInt(e.target.value);
                    this.renderChart();
                }
            });
        });
        
        // Transaction filter
        const txnFilter = document.getElementById('txnFilter');
        if (txnFilter) {
            txnFilter.addEventListener('change', (e) => this.filterTransactions(e.target.value));
        }

        document.addEventListener('currency:changed', () => {
            if (this.plData) {
                this.updateSummaryCards();
            }
            if (this.transactions.length) {
                this.renderTransactionTable();
                this.updateTransactionPnL();
            }
        });
    }
    
    async loadInitialData() {
        await Promise.all([
            this.loadPortfolioData(),
            this.loadPriceHistory(),
            this.loadTransactionHistory()
        ]);
        this.renderChart();
        this.updateTransactionPnL();
    }
    
    async loadPortfolioData() {
        try {
            const response = await fetch('/api/portfolio/pl');
            if (!response.ok) throw new Error('Failed to fetch portfolio');
            
            this.plData = await response.json();
            this.updateSummaryCards();
        } catch (error) {
            console.error('Error loading portfolio:', error);
        }
    }
    
    async loadPriceHistory() {
        try {
            const days = this.chartPeriod === 'all' ? 365 : this.chartPeriod;
            const response = await fetch(`/api/price/history?days=${days}&interval=1`);
            if (!response.ok) throw new Error('Failed to fetch price history');
            
            const data = await response.json();
            this.priceHistory = data.data || [];
        } catch (error) {
            console.error('Error loading price history:', error);
            this.priceHistory = [];
        }
    }
    
    async loadTransactionHistory() {
        try {
            const response = await fetch('/api/transactions/history');
            if (!response.ok) throw new Error('Failed to fetch transactions');
            
            this.transactions = await response.json();
            this.renderTransactionTable();
        } catch (error) {
            console.error('Error loading transactions:', error);
        }
    }
    
    updateSummaryCards() {
        if (!this.plData) return;

        const currencyManager = window.currencyManager || null;
        const formatMoney = (val) => currencyManager ? currencyManager.formatMoney(val) : '$' + parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formatSignedMoney = (val) => currencyManager ? currencyManager.formatSignedMoney(val) : (val >= 0 ? '+' : '') + '$' + Math.abs(parseFloat(val)).toFixed(2);
        const formatUsdt = (val) => parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 }) + ' USDT';
        const formatPct = (val) => currencyManager ? currencyManager.formatSignedPercent(val) : (val >= 0 ? '+' : '') + parseFloat(val).toFixed(2) + '%';
        
        // Update cards
        this.updateElement('dashUsdtHeld', formatUsdt(this.plData.total_usdt_held));
        this.updateElement('dashPortfolioValue', formatMoney(this.plData.current_value_usd));
        this.updateElement('dashCostBasis', formatMoney(this.plData.total_cost_basis));
        this.updateElement('dashAvgBuy', formatMoney(this.plData.average_buy_price));
        
        const unrealizedPl = this.plData.unrealized_pl_usd;
        this.updateElement('dashUnrealizedPl', formatSignedMoney(unrealizedPl));
        this.updateElement('dashUnrealizedPct', formatPct(this.plData.unrealized_pl_pct));
        
        const totalPl = this.plData.total_pl_usd;
        this.updateElement('dashTotalPl', formatSignedMoney(totalPl));
        this.updateElement('dashRoi', formatPct(
            this.plData.net_invested_usd > 0 
                ? (this.plData.total_pl_usd / this.plData.net_invested_usd * 100)
                : 0
        ));
        
        // Market price
        this.updateElement('dashMarketPrice', formatMoney(this.plData.current_price_usd));
        
        const priceVsAvg = this.plData.average_buy_price > 0
            ? ((this.plData.current_price_usd - this.plData.average_buy_price) / this.plData.average_buy_price * 100)
            : 0;
        this.updateElement('dashPriceVsAvg', formatPct(priceVsAvg));
        
        // Color coding for unrealized P/L
        const unrealizedIcon = document.getElementById('dashUnrealizedIcon');
        const unrealizedIconInner = document.getElementById('dashUnrealizedIconInner');
        if (unrealizedIcon && unrealizedIconInner) {
            if (unrealizedPl >= 0) {
                unrealizedIcon.className = 'bg-success bg-opacity-10 text-success rounded-circle p-3';
                unrealizedIconInner.className = 'bi bi-graph-up-arrow fs-3';
            } else {
                unrealizedIcon.className = 'bg-danger bg-opacity-10 text-danger rounded-circle p-3';
                unrealizedIconInner.className = 'bi bi-graph-down-arrow fs-3';
            }
        }
        
        // Update price progress bar (showing how close to $1.00)
        const priceProgress = document.getElementById('dashPriceProgress');
        if (priceProgress) {
            const price = this.plData.current_price_usd;
            // For USDT, show deviation from $1.00
            const deviation = Math.abs(price - 1.0) * 100; // percentage deviation
            const width = Math.min(100, Math.max(0, 50 - (price - 1.0) * 5000)); // Center at 50%
            priceProgress.style.width = width + '%';
            priceProgress.className = 'progress-bar ' + (price >= 1.0 ? 'bg-success' : 'bg-warning');
        }
        
        // Quick stats
        this.updateElement('statTotalInvested', formatMoney(this.plData.total_invested_usd));
        this.updateElement('statTotalWithdrawn', formatMoney(this.plData.total_withdrawn_usd));
        this.updateElement('statNetInvested', formatMoney(this.plData.net_invested_usd));
        this.updateElement('statOpenLots', this.plData.lot_count);
        this.updateElement('statRealizedPl', formatSignedMoney(this.plData.realized_pl_usd));
        
        // Price updated time
        const priceUpdated = document.getElementById('dashPriceUpdated');
        if (priceUpdated && this.plData.timestamp) {
            const date = new Date(this.plData.timestamp * 1000);
            priceUpdated.textContent = 'Updated: ' + date.toLocaleTimeString();
        }
        
        this.updateLastRefresh();
    }
    
    renderChart() {
        const ctx = document.getElementById('portfolioChart');
        if (!ctx) return;
        
        // Prepare chart data by combining portfolio history with price history
        const chartData = this.prepareChartData();
        
        const datasets = [
            {
                label: 'Portfolio Value ($)',
                data: chartData.portfolioValues,
                borderColor: 'rgb(13, 110, 253)',
                backgroundColor: this.chartType === 'area' ? 'rgba(13, 110, 253, 0.1)' : 'transparent',
                fill: this.chartType === 'area',
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2,
                yAxisID: 'y'
            },
            {
                label: 'Cost Basis ($)',
                data: chartData.costBasis,
                borderColor: 'rgb(25, 135, 84)',
                backgroundColor: this.chartType === 'area' ? 'rgba(25, 135, 84, 0.1)' : 'transparent',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2,
                borderDash: [5, 5],
                yAxisID: 'y'
            },
            {
                label: 'USDT Holdings',
                data: chartData.holdings,
                borderColor: 'rgb(13, 202, 240)',
                backgroundColor: this.chartType === 'area' ? 'rgba(13, 202, 240, 0.1)' : 'transparent',
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                pointHoverRadius: 4,
                borderWidth: 2,
                yAxisID: 'y1'
            }
        ];
        
        const config = {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            padding: 20,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        padding: 12,
                        titleFont: { size: 13 },
                        bodyFont: { size: 12 },
                        callbacks: {
                            label: (context) => {
                                if (context.dataset.yAxisID === 'y1') {
                                    return context.dataset.label + ': ' + context.parsed.y.toFixed(8) + ' USDT';
                                }
                                return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                            }
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
                                return new Date(label).toLocaleDateString();
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        grid: { color: 'rgba(0, 0, 0, 0.05)' },
                        ticks: {
                            callback: (value) => '$' + value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
                        },
                        beginAtZero: false
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: {
                            callback: (value) => value.toFixed(2) + ' USDT'
                        },
                        beginAtZero: false
                    }
                },
                animation: {
                    duration: 500
                }
            }
        };
        
        if (this.portfolioChart) {
            this.portfolioChart.data = config.data;
            this.portfolioChart.options = config.options;
            this.portfolioChart.update();
        } else {
            this.portfolioChart = new Chart(ctx, config);
        }
    }
    
    prepareChartData() {
        // Generate portfolio value over time using price history and transaction history
        const labels = [];
        const portfolioValues = [];
        const costBasis = [];
        const holdings = [];
        
        if (this.priceHistory.length === 0) {
            // No price history - create single point from current data
            const now = new Date();
            labels.push(now.toISOString());
            portfolioValues.push(this.plData?.current_value_usd || 0);
            costBasis.push(this.plData?.total_cost_basis || 0);
            holdings.push(this.plData?.total_usdt_held || 0);
            return { labels, portfolioValues, costBasis, holdings };
        }
        
        // Get transactions for cost basis calculation over time
        const buyTransactions = this.transactions
            .filter(t => t.transaction_type === 'buy')
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        
        const sellTransactions = this.transactions
            .filter(t => t.transaction_type === 'sell')
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Sample price history at intervals
        const sampleInterval = Math.max(1, Math.floor(this.priceHistory.length / 50));
        
        for (let i = 0; i < this.priceHistory.length; i += sampleInterval) {
            const pricePoint = this.priceHistory[i];
            const price = pricePoint.price_usd;
            const timestamp = pricePoint.timestamp;
            
            // Calculate holdings and cost basis at this point in time
            let usdtHeld = 0;
            let cost = 0;
            
            // Apply all transactions up to this timestamp
            for (const txn of buyTransactions) {
                if (new Date(txn.date) <= new Date(timestamp)) {
                    usdtHeld += parseFloat(txn.usdt_amount);
                    cost += parseFloat(txn.usdt_amount) * parseFloat(txn.price_per_unit);
                }
            }
            for (const txn of sellTransactions) {
                if (new Date(txn.date) <= new Date(timestamp)) {
                    usdtHeld -= parseFloat(txn.usdt_amount);
                    // Cost basis reduction (FIFO simplified)
                    cost -= parseFloat(txn.usdt_amount) * parseFloat(txn.price_per_unit);
                }
            }
            
            labels.push(timestamp);
            portfolioValues.push(usdtHeld * price);
            costBasis.push(Math.max(0, cost));
            holdings.push(usdtHeld);
        }
        
        // Add current point
        if (this.plData) {
            const now = new Date().toISOString();
            labels.push(now);
            portfolioValues.push(this.plData.current_value_usd);
            costBasis.push(this.plData.total_cost_basis);
            holdings.push(this.plData.total_usdt_held);
        }
        
        return { labels, portfolioValues, costBasis, holdings };
    }
    
    toggleChartType() {
        this.chartType = this.chartType === 'area' ? 'line' : 'area';
        const btn = document.getElementById('chartTypeBtn');
        if (btn) btn.textContent = this.chartType === 'area' ? 'Line' : 'Area';
        this.renderChart();
    }
    
    exportChart() {
        if (this.portfolioChart) {
            const link = document.createElement('a');
            link.download = `portfolio-chart-${new Date().toISOString().split('T')[0]}.png`;
            link.href = this.portfolioChart.toBase64Image();
            link.click();
        }
    }
    
    renderTransactionTable() {
        const tbody = document.getElementById('txnTableBody');
        if (!tbody) return;

        const currencyManager = window.currencyManager || null;
        const formatMoney = (val) => currencyManager ? currencyManager.formatMoney(val) : '$' + parseFloat(val).toFixed(2);
        const formatSignedMoney = (val) => currencyManager ? currencyManager.formatSignedMoney(val) : (val >= 0 ? '+' : '') + '$' + Math.abs(parseFloat(val)).toFixed(2);
        
        // Show last 20 transactions
        const displayTxns = this.transactions.slice(0, 20);
        
        if (displayTxns.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No transactions</td></tr>';
            return;
        }
        
        tbody.innerHTML = displayTxns.map(txn => {
            const date = txn.date ? new Date(txn.date).toLocaleString() : 'N/A';
            const typeClass = txn.transaction_type === 'buy' ? 'success' : 'danger';
            const typeIcon = txn.transaction_type === 'buy' ? 'arrow-down' : 'arrow-up';
            const usdValue = parseFloat(txn.usdt_amount) * parseFloat(txn.price_per_unit);
            const currentValue = txn.current_value || usdValue;
            const unrealizedPl = txn.unrealized_pl || 0;
            const unrealizedPlPct = txn.unrealized_pl_pct || 0;
            
            return `
                <tr data-type="${txn.transaction_type}">
                    <td class="small">${date}</td>
                    <td>
                        <span class="badge bg-${typeClass} px-2 py-1">
                            <i class="bi bi-${typeIcon} me-1"></i>${txn.transaction_type.toUpperCase()}
                        </span>
                    </td>
                    <td class="fw-monospace small">${parseFloat(txn.usdt_amount).toFixed(8)}</td>
                    <td class="fw-monospace small">${formatMoney(txn.price_per_unit)}</td>
                    <td class="fw-bold small">${formatMoney(usdValue)}</td>
                    <td class="fw-bold small text-muted" id="txnCurrentVal-${txn.id}">${formatMoney(currentValue)}</td>
                    <td class="small ${unrealizedPl >= 0 ? 'text-success' : 'text-danger'}" id="txnPl-${txn.id}">
                        ${formatSignedMoney(unrealizedPl)} (${currencyManager ? currencyManager.formatSignedPercent(unrealizedPlPct) : (unrealizedPlPct >= 0 ? '+' : '') + unrealizedPlPct.toFixed(2) + '%'})
                    </td>
                    <td>
                        ${txn.notes ? `<span class="text-truncate d-inline-block" style="max-width: 150px;" title="${txn.notes.replace(/"/g, '"')}">${txn.notes}</span>` : '<span class="text-muted">—</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    filterTransactions(filter) {
        const rows = document.querySelectorAll('#txnTableBody tr[data-type]');
        rows.forEach(row => {
            if (filter === 'all' || row.dataset.type === filter) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }
    
    updateTransactionPnL() {
        if (!this.plData || !this.transactions.length) return;
        
        const currentPrice = this.plData.current_price_usd;
        
        this.transactions.forEach(txn => {
            if (txn.transaction_type === 'buy') {
                const amount = parseFloat(txn.usdt_amount);
                const buyPrice = parseFloat(txn.price_per_unit);
                const currentValue = amount * currentPrice;
                const unrealizedPl = amount * (currentPrice - buyPrice);
                const unrealizedPlPct = ((currentPrice - buyPrice) / buyPrice) * 100;
                
                const currentValEl = document.getElementById(`txnCurrentVal-${txn.id}`);
                const plEl = document.getElementById(`txnPl-${txn.id}`);
                
                const currencyManager = window.currencyManager || null;
                if (currentValEl) currentValEl.textContent = currencyManager ? currencyManager.formatMoney(currentValue) : '$' + currentValue.toFixed(2);
                if (plEl) {
                    plEl.textContent = (currencyManager ? currencyManager.formatSignedMoney(unrealizedPl) : (unrealizedPl >= 0 ? '+' : '') + '$' + Math.abs(unrealizedPl).toFixed(2)) + ' (' + (currencyManager ? currencyManager.formatSignedPercent(unrealizedPlPct) : (unrealizedPlPct >= 0 ? '+' : '') + unrealizedPlPct.toFixed(2) + '%') + ')';
                    plEl.className = 'small ' + (unrealizedPl >= 0 ? 'text-success' : 'text-danger');
                }
            }
        });
    }
    
    async refreshAll() {
        const btn = event?.target?.closest('button');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="bi bi-arrow-clockwise spin me-1"></i>Refreshing...';
        }
        
        await Promise.all([
            this.loadPortfolioData(),
            this.loadPriceHistory(),
            this.loadTransactionHistory()
        ]);
        
        this.renderChart();
        this.updateTransactionPnL();
        
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Refresh';
        }
        
        this.showToast('Dashboard refreshed', 'success');
    }
    
    startAutoRefresh() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        this.refreshInterval = setInterval(() => {
            if (this.autoRefreshEnabled && document.visibilityState === 'visible') {
                this.loadPortfolioData();
                this.updateTransactionPnL();
            }
        }, this.refreshIntervalMs);
    }
    
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
    
    updateElement(id, value) {
        const el = document.getElementById(id);
        if (el && value !== null && value !== undefined) {
            el.textContent = value;
            
            // Color coding for P/L elements
            if (id.includes('Pl') || id.includes('ROI') || id.includes('PriceVs')) {
                const numValue = parseFloat(String(value).replace(/[$,+%]/g, ''));
                if (!isNaN(numValue)) {
                    el.className = 'fw-bold ' + (numValue >= 0 ? 'text-success' : 'text-danger');
                }
            }
        }
    }
    
    updateLastRefresh() {
        // Could add a small indicator showing last refresh time
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
        const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
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
}

// Global functions
function refreshDashboard() {
    if (window.dashboardManager) {
        window.dashboardManager.refreshAll();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardManager = new DashboardManager();
    
    // Pause auto-refresh when tab is hidden
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && window.dashboardManager) {
            window.dashboardManager.stopAutoRefresh();
        } else if (document.visibilityState === 'visible' && window.dashboardManager) {
            window.dashboardManager.startAutoRefresh();
        }
    });
});

// Add spin animation for refresh button
const style = document.createElement('style');
style.textContent = `
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
    .spin { animation: spin 1s linear infinite; }
`;
document.head.appendChild(style);