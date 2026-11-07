const types = ['Petición', 'Queja', 'Reclamo', 'Sugerencia'];
const services = ['Recolección de residuos', 'Barrido y limpieza', 'Residuos aprovechables', 'Residuos especiales y voluminosos', 'Facturación', 'Otro'];
const phonePattern = String.raw`(?=(?:[^0-9]*[0-9]){7,15}[^0-9]*$)\+?(?:[0-9]| |\(|\)|-)+`;
const documentTypes = ['Cédula de ciudadanía', 'Cédula de extranjería', 'Pasaporte', 'NIT'];
const ethnicGroups = ['Indígena', 'Gitano o Rrom', 'Negro(a) afrodescendiente', 'Afrocolombiano(a)', 'Palenquero(a)', 'Raizal', 'No aplica'];
const documentPattern = String.raw`[A-Za-z0-9][A-Za-z0-9. \-]{2,29}`;

function isValidPhone(value) {
  return typeof value === 'string' && value.length <= 30 && new RegExp(`^${phonePattern}$`).test(value);
}

module.exports = { types, services, phonePattern, isValidPhone, documentTypes, ethnicGroups, documentPattern };
