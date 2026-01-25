function showTab(tabId) {

    const tabs = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.classList.add('hidden');
    });

    document.getElementById(tabId).classList.remove('hidden');
}
