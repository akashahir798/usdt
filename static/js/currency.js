(function () {
    const supportedCurrencies = {
        USD: { label: 'United States (USD)', symbol: '$', rate: 1 },
        INR: { label: 'India (INR)', symbol: '₹', rate: 83.2 },
        EUR: { label: 'Eurozone (EUR)', symbol: '€', rate: 0.92 },
        GBP: { label: 'United Kingdom (GBP)', symbol: '£', rate: 0.79 },
        JPY: { label: 'Japan (JPY)', symbol: '¥', rate: 158.5 },
        AUD: { label: 'Australia (AUD)', symbol: 'A$', rate: 1.52 },
        CAD: { label: 'Canada (CAD)', symbol: 'C$', rate: 1.36 },
        SGD: { label: 'Singapore (SGD)', symbol: 'S$', rate: 1.35 },
        AED: { label: 'UAE (AED)', symbol: 'د.إ', rate: 3.67 },
        CNY: { label: 'China (CNY)', symbol: '¥', rate: 7.28 },
        CHF: { label: 'Switzerland (CHF)', symbol: 'CHF', rate: 0.88 },
        KRW: { label: 'South Korea (KRW)', symbol: '₩', rate: 1380 }
    };

    const fallbackRates = Object.fromEntries(
        Object.entries(supportedCurrencies).map(([code, config]) => [code, config.rate])
    );

    const state = {
        selectedCurrency: 'USD',
        rates: { ...fallbackRates }
    };

    function safeNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function readStoredCurrency() {
        try {
            const stored = localStorage.getItem('usdt_currency_preference');
            return stored && supportedCurrencies[stored] ? stored : 'USD';
        } catch (error) {
            return 'USD';
        }
    }

    function setStoredCurrency(currency) {
        try {
            localStorage.setItem('usdt_currency_preference', currency);
        } catch (error) {
            // Ignore storage failures gracefully.
        }
    }

    async function loadRates() {
        try {
            const response = await fetch('https://api.frankfurter.app/latest?from=USD');
            if (!response.ok) throw new Error('Currency API unavailable');
            const data = await response.json();
            const nextRates = { ...fallbackRates };

            Object.entries(data.rates || {}).forEach(([currency, rate]) => {
                if (supportedCurrencies[currency]) {
                    nextRates[currency] = Number(rate);
                }
            });

            state.rates = nextRates;
        } catch (error) {
            state.rates = { ...fallbackRates };
        }
    }

    function updateSelector() {
        const select = document.getElementById('currencySelect');
        if (!select) return;
        select.value = state.selectedCurrency;
    }

    function updatePageMeta() {
        document.body.dataset.currency = state.selectedCurrency;
        const symbol = supportedCurrencies[state.selectedCurrency]?.symbol || '$';
        document.documentElement.style.setProperty('--selected-currency-symbol', symbol);
    }

    function formatMoney(value, currency = state.selectedCurrency) {
        const numeric = safeNumber(value);
        const rate = state.rates[currency] || 1;
        const converted = numeric * rate;
        const formatter = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return formatter.format(converted);
    }

    function formatSignedMoney(value, currency = state.selectedCurrency) {
        const numeric = safeNumber(value);
        const sign = numeric >= 0 ? '+' : '-';
        const absolute = Math.abs(numeric);
        return `${sign}${formatMoney(absolute, currency)}`;
    }

    function formatPercent(value) {
        const numeric = safeNumber(value);
        return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
    }

    function formatSignedPercent(value) {
        const numeric = safeNumber(value);
        return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`;
    }

    function setCurrency(currency) {
        if (!supportedCurrencies[currency]) return;
        state.selectedCurrency = currency;
        setStoredCurrency(currency);
        updateSelector();
        updatePageMeta();
        document.dispatchEvent(new CustomEvent('currency:changed', {
            detail: { currency }
        }));
    }

    function bindSelector() {
        const select = document.getElementById('currencySelect');
        if (!select) return;

        select.innerHTML = Object.entries(supportedCurrencies)
            .map(([code, config]) => `<option value="${code}">${config.label}</option>`)
            .join('');

        select.addEventListener('change', (event) => {
            setCurrency(event.target.value);
        });

        updateSelector();
    }

    document.addEventListener('DOMContentLoaded', async () => {
        state.selectedCurrency = readStoredCurrency();
        bindSelector();
        updatePageMeta();
        await loadRates();
        updateSelector();
        updatePageMeta();
        document.dispatchEvent(new CustomEvent('currency:ready', {
            detail: { currency: state.selectedCurrency }
        }));
        document.dispatchEvent(new CustomEvent('currency:changed', {
            detail: { currency: state.selectedCurrency }
        }));
    });

    window.currencyManager = {
        state,
        formatMoney,
        formatSignedMoney,
        formatPercent,
        formatSignedPercent,
        setCurrency,
        getSelectedCurrency: () => state.selectedCurrency,
        getSymbol: () => supportedCurrencies[state.selectedCurrency]?.symbol || '$',
        getLabel: () => supportedCurrencies[state.selectedCurrency]?.label || 'United States (USD)',
        loadRates,
        updateSelector,
        updatePageMeta
    };
})();
