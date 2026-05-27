const ods = require('../middlewares/ficherosODS');

async function parseODS(filePath) {
  try {
    const data = await ods.parseMyFile(filePath);
    //console.log(data);
    return data;
  } catch (error) {
    console.error('Error al parsear el archivo:', error);
    throw error;
  }
}

module.exports = {
  parseODS,
};

// Para usar esta función en tu app.js, puedes hacer algo como esto:

//const { inicializarApp } = require('./utils/odsInit');

//parseODS('./DOCE-ABRIL.ods')
//  .then((datos) => {
//
//    console.log('Datos obtenidos:', datos);
//
//  })
//  .catch((error) => {
//    console.error('Inicialización ODS fallida:', error.message);
//  });
