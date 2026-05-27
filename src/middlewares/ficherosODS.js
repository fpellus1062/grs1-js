// src/middlewares/ficherosODS.js
const fs = require('fs');
const officeParser = require('officeparser');

module.exports.parseMyFile = async (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`El archivo ${filePath} no existe`);
    }

    const data = await officeParser.parseOffice(filePath);
    return data;
  } catch (error) {
    console.error(`Error al parsear el archivo ${filePath}:`, error.message);

    const customError = new Error(
      `Error al procesar el archivo ODS: ${error.message}`
    );
    customError.status = 500;
    throw customError;
  }
};
