export const PROVINCE_CITIES = {
  'Gauteng': [
    'Johannesburg', 'Pretoria', 'Sandton', 'Midrand', 'Centurion',
    'Randburg', 'Roodepoort', 'Soweto', 'Boksburg', 'Benoni',
    'Kempton Park', 'Germiston', 'Fourways', 'Edenvale', 'Alberton'
  ],
  'Western Cape': [
    'Cape Town', 'Bellville', 'Claremont', 'Wynberg', 'Durbanville',
    'Somerset West', 'Stellenbosch', 'Paarl', 'George', 'Knysna',
    'Mossel Bay', 'Hermanus', 'Strand', 'Brackenfell', 'Tableview'
  ],
  'KwaZulu-Natal': [
    'Durban', 'Umhlanga', 'Pinetown', 'Pietermaritzburg', 'Ballito',
    'Richards Bay', 'Newcastle', 'Amanzimtoti', 'Hillcrest', 'Westville',
    'Berea', 'Chatsworth', 'Phoenix', 'Tongaat', 'Empangeni'
  ],
  'Eastern Cape': [
    'Gqeberha (Port Elizabeth)', 'East London', 'Mthatha', 'Uitenhage',
    'Makhanda (Grahamstown)', 'Queenstown', 'King Williams Town',
    'Butterworth', 'Jeffreys Bay', 'Port Alfred'
  ],
  'Limpopo': [
    'Polokwane', 'Tzaneen', 'Lephalale', 'Louis Trichardt',
    'Mokopane', 'Bela-Bela', 'Thohoyandou', 'Phalaborwa', 'Giyani', 'Burgersfort'
  ],
  'Mpumalanga': [
    'Mbombela (Nelspruit)', 'eMalahleni (Witbank)', 'Secunda',
    'Middelburg', 'Barberton', 'White River', 'Standerton',
    'Ermelo', 'Lydenburg', 'Hazyview'
  ],
  'North West': [
    'Rustenburg', 'Klerksdorp', 'Mahikeng', 'Potchefstroom',
    'Brits', 'Hartbeespoort', 'Lichtenburg', 'Orkney', 'Vryburg', 'Zeerust'
  ],
  'Free State': [
    'Bloemfontein', 'Welkom', 'Sasolburg', 'Phuthaditjhaba',
    'Kroonstad', 'Bethlehem', 'Harrismith', 'Parys', 'Botshabelo', 'Virginia'
  ],
  'Northern Cape': [
    'Kimberley', 'Upington', 'Springbok', 'De Aar',
    'Kuruman', 'Calvinia', 'Colesberg', 'Douglas', 'Prieska', 'Carnarvon'
  ]
}

export function getAllCities() {
  return Object.values(PROVINCE_CITIES).flat().sort()
}

export function getCitiesForProvince(province) {
  return PROVINCE_CITIES[province] || []
}
