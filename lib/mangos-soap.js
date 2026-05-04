const http = require('http');

// Send a GM command to MaNGOS via SOAP
function soapCommand(command) {
  return new Promise((resolve, reject) => {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:MaNGOS">
  <SOAP-ENV:Body>
    <ns1:executeCommand>
      <command>${command}</command>
    </ns1:executeCommand>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

    const auth = Buffer.from(
      `${process.env.SOAP_USER}:${process.env.SOAP_PASS}`
    ).toString('base64');

    const options = {
      hostname: process.env.SOAP_HOST,
      port: parseInt(process.env.SOAP_PORT),
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        // Extract result from SOAP response
        const match = data.match(/<result>([\s\S]*?)<\/result>/);
        const result = match ? match[1].trim() : data;
        if (res.statusCode === 200) {
          resolve(result);
        } else {
          reject(new Error(`SOAP ${res.statusCode}: ${result}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Convenience wrappers
const soap = {
  // Add a battlebot to WSG queue
  async addBattleBot(faction, level = 60) {
    return soapCommand(`battlebot add warsong ${faction} ${level}`);
  },

  // Remove all battlebots
  async removeBots() {
    return soapCommand('battlebot remove all');
  },

  // Create an account via console command
  async createAccount(username, password) {
    return soapCommand(`account create ${username} ${password}`);
  },

  // Set account GM level
  async setGmLevel(username, level) {
    return soapCommand(`account set gmlevel ${username} ${level}`);
  },

  // Send a raw command
  async raw(command) {
    return soapCommand(command);
  },
};

module.exports = soap;
