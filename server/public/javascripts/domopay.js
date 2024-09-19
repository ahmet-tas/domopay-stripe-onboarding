// Toggle between each type of legal entity (business or individual) in the signup form
document.body.addEventListener('change', function(e) {
  if (e.target.name !== 'serviceVendor-type') {
    return;
  }

  // Show the correct header for the select legal entity
  var headerPrefix = e.target.value === 'individual' ? 'Persönliche' : 'Firmen';
  document.querySelector(
    '.serviceVendor-header#account-info'
  ).innerText = `${headerPrefix} Daten`;

  // Show any fields that apply to the new serviceVendor type
  var serviceVendorInfoRows = document.querySelectorAll('.serviceVendor-info');
  serviceVendorInfoRows.forEach(function(row) {
    row.classList.toggle('hidden', !row.classList.contains(e.target.value));
  });
});

// Enable sequence of annotation cards on the Dashboard
const dashboardAnnotation = document.querySelector('.annotation.dashboard-banner button.next');
if (dashboardAnnotation !== null) {
  dashboardAnnotation.addEventListener('click', function(e) {
    e.preventDefault();
    document
      .querySelector('.annotation.dashboard-banner')
      .classList.toggle('hidden');
    document
      .querySelector('.annotation.dashboard-simulate')
      .classList.toggle('hidden');
  }); 
}

// In mobile / responsive mode, toggle showing details on annotation cards
document.querySelectorAll('.annotation.card').forEach(function(card) {
  card.querySelector('h4').addEventListener('click', function(e) {
    card.querySelector('a.show-more').classList.toggle('expanded');
    card.querySelector('.description').classList.toggle('expanded');
  });
});
