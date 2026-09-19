// Portfolio Management JavaScript
class PortfolioManager {
    constructor() {
        this.plData = null;
        this.refreshInterval = null;
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        document.addEventListener('currency:changed', () => {
            if (this.plData) {
                this.updatePortfolioDisplay();
            }
            this.loadTransactionHistory();
        });
        this.loadPortfolioData();
        this.loadTransactionHistory();
    }
    
    bindEvents() {
        // Refresh button
        const refreshBtn = document.querySelector('button[onclick="refreshPortfolio()"]');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadPortfolioData());
        }
    }
    
    async loadPortfolioData() {
        try {
            const response = await fetch('/api/portfolio/pl');
            if (!response.ok) throw new Error('Failed to fetch portfolio');
            
            this.plData = await response.json();
            this.updatePortfolioDisplay();
        } catch (error) {
            console.error('Error loading portfolio:', error);
            this.showError('Failed to load portfolio data');
        }
    }
    
    async loadTransactionHistory() {
        try {
            const response = await fetch('/api/transactions/history');
            if (!response.ok) throw new Error('Failed to fetch transactions');
            
            const transactions = await response.json();
            this.renderTransactionHistory(transactions);
        } catch (error) {
            console.error('Error loading transaction history:', error);
        }
    }
    
    updatePortfolioDisplay() {
        if (!this.plData) return;

        const currencyManager = window.currencyManager || null;
        const formatMoney = (val) => currencyManager ? currencyManager.formatMoney(val) : '$' + parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formatSignedMoney = (val) => currencyManager ? currencyManager.formatSignedMoney(val) : (val >= 0 ? '+' : '') + '$' + Math.abs(parseFloat(val)).toFixed(2);
        const formatPct = (val) => currencyManager ? currencyManager.formatSignedPercent(val) : (val >= 0 ? '+' : '') + parseFloat(val).toFixed(2) + '%';
        const formatUsdt = (val) => parseFloat(val).toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 }) + ' USDT';
        
        // Update summary cards
        this.updateElement('holdingUsdt', formatUsdt(this.plData.total_usdt_held));
        this.updateElement('currentValue', formatMoney(this.plData.current_value_usd));
        
        const unrealizedPl = this.plData.unrealized_pl_usd;
        this.updateElement('unrealizedPl', formatSignedMoney(unrealizedPl));
        this.updateElement('unrealizedPl', null, this.plData.unrealized_pl_pct, 'unrealizedPlPct');
        
        const totalPl = this.plData.total_pl_usd;
        this.updateElement('totalPl', formatSignedMoney(totalPl));
        
        // Update detailed metrics
        this.updateElement('avgBuyPrice', formatMoney(this.plData.average_buy_price));
        this.updateElement('currentPrice', formatMoney(this.plData.current_price_usd));
        
        const priceChange = this.plData.average_buy_price > 0 
            ? ((this.plData.current_price_usd - this.plData.average_buy_price) / this.plData.average_buy_price * 100)
            : 0;
        this.updateElement('priceChange', formatPct(priceChange), null, 'priceChange');
        
        this.updateElement('breakeven', formatMoney(this.plData.average_buy_price));
        this.updateElement('totalInvested', formatMoney(this.plData.total_invested_usd));
        this.updateElement('totalWithdrawn', formatMoney(this.plData.total_withdrawn_usd));
        this.updateElement('netInvested', formatMoney(this.plData.net_invested_usd));
        
        const roi = this.plData.net_invested_usd > 0 
            ? (this.plData.total_pl_usd / this.plData.net_invested_usd * 100)
            : 0;
        this.updateElement('roi', formatPct(roi));
        
        // Update lot count
        this.updateElement('lotCount', this.plData.lot_count + ' lots');
        
        // Update lots table
        this.renderLotsTable();
        
        // Update timestamp
        this.updateLastRefresh();
    }
    
    renderLotsTable() {
        const tbody = document.getElementById('lotsTable');
        if (!tbody || !this.plData || !this.plData.lots) return;
        
        if (this.plData.lots.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No open tax lots</td></tr>';
            return;
        }
        
        const currencyManager = window.currencyManager || null;
        const formatMoney = (val) => currencyManager ? currencyManager.formatMoney(val) : '$' + parseFloat(val).toFixed(2);
        const formatSignedMoney = (val) => currencyManager ? currencyManager.formatSignedMoney(val) : (val >= 0 ? '+' : '') + '$' + Math.abs(parseFloat(val)).toFixed(2);
        const formatSignedPercent = (val) => currencyManager ? currencyManager.formatSignedPercent(val) : (val >= 0 ? '+' : '') + parseFloat(val).toFixed(2) + '%';

        tbody.innerHTML = this.plData.lots.map(lot => `
            <tr>
                <td>${lot.buy_date ? lot.buy_date.substring(0, 10) : 'N/A'}</td>
                <td class="fw-monospace">${parseFloat(lot.amount).toFixed(8)}</td>
                <td class="fw-monospace">${formatMoney(lot.buy_price)}</td>
                <td class="fw-monospace">${formatMoney(this.plData.current_price_usd)}</td>
                <td class="fw-bold">${formatMoney(lot.current_value)}</td>
                <td class="${lot.unrealized_pl >= 0 ? 'text-success' : 'text-danger'} fw-bold">
                    ${formatSignedMoney(lot.unrealized_pl)}
                </td>
                <td class="${lot.unrealized_pl_pct >= 0 ? 'text-success' : 'text-danger'} fw-bold">
                    ${formatSignedPercent(lot.unrealized_pl_pct)}
                </td>
            </tr>
        `).join('');
    }
    
    renderTransactionHistory(transactions) {
        const tbody = document.getElementById('txnHistoryTable');
        if (!tbody) return;
        
        if (!transactions || transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No transactions</td></tr>';
            return;
        }
        
        const currencyManager = window.currencyManager || null;
        const formatMoney = (val) => currencyManager ? currencyManager.formatMoney(val) : '$' + parseFloat(val).toFixed(2);
        const formatSignedMoney = (val) => currencyManager ? currencyManager.formatSignedMoney(val) : (val >= 0 ? '+' : '') + '$' + Math.abs(parseFloat(val)).toFixed(2);
        const formatSignedPercent = (val) => currencyManager ? currencyManager.formatSignedPercent(val) : (val >= 0 ? '+' : '') + parseFloat(val).toFixed(2) + '%';

        tbody.innerHTML = transactions.map(txn => {
            const date = txn.date ? new Date(txn.date).toLocaleString() : 'N/A';
            const typeBadge = txn.transaction_type === 'buy' 
                ? '<span class="badge bg-success"><i class="bi bi-arrow-down me-1"></i>BUY</span>'
                : '<span class="badge bg-danger"><i class="bi bi-arrow-up me-1"></i>SELL</span>';
            
            const usdValue = parseFloat(txn.usdt_amount) * parseFloat(txn.price_per_unit);
            const currentValue = txn.current_value || usdValue;
            const unrealizedPl = txn.unrealized_pl || 0;
            const unrealizedPlPct = txn.unrealized_pl_pct || 0;
            
            return `
                <tr>
                    <td>${date}</td>
                    <td>${typeBadge}</td>
                    <td class="fw-monospace">${parseFloat(txn.usdt_amount).toFixed(8)}</td>
                    <td class="fw-monospace">${formatMoney(txn.price_per_unit)}</td>
                    <td class="fw-bold">${formatMoney(usdValue)}</td>
                    <td class="fw-bold">${formatMoney(currentValue)}</td>
                    <td class="${unrealizedPl >= 0 ? 'text-success' : 'text-danger'} fw-bold">
                        ${formatSignedMoney(unrealizedPl)} (${formatSignedPercent(unrealizedPlPct)})
                    </td>
                    <td>${txn.notes || '<span class="text-muted">—</span>'}</td>
                </tr>
            `;
        }).join('');
    }
    
    updateElement(id, value, pctValue = null, pctId = null) {
        const el = document.getElementById(id);
        if (el && value !== null) {
            el.textContent = value;
            
            // Update color based on value
            if (id.includes('Pl') || id.includes('ROI') || id === 'priceChange') {
                const numValue = parseFloat(value.replace(/[$,+%]/g, ''));
                el.className = 'fw-bold ' + (numValue >= 0 ? 'text-success' : 'text-danger');
            }
        }
        
        if (pctValue !== null && pctId) {
            const pctEl = document.getElementById(pctId);
            if (pctEl) {
                pctEl.textContent = pctValue >= 0 ? '+' + pctValue.toFixed(2) + '%' : pctValue.toFixed(2) + '%';
                pctEl.className = 'text-muted ' + (pctValue >= 0 ? 'text-success' : 'text-danger');
            }
        }
    }
    
    updateLastRefresh() {
        const badge = document.getElementById('currentPriceBadge');
        if (badge && this.plData) {
            const currencyManager = window.currencyManager || null;
            badge.textContent = currencyManager ? currencyManager.formatMoney(this.plData.current_price_usd) : '$' + parseFloat(this.plData.current_price_usd).toFixed(4);
        }
    }
    
    showError(message) {
        const toastContainer = this.getOrCreateToastContainer();
        const toastEl = document.createElement('div');
        toastEl.className = 'toast align-items-center text-white bg-danger border-0';
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
}

// Global function for inline onclick
function refreshPortfolio() {
    if (window.portfolioManager) {
        window.portfolioManager.loadPortfolioData();
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.portfolioManager = new PortfolioManager();
});