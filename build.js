// build.js
const fs = require('fs');
const version = new Date().toISOString();
fs.writeFileSync('./build-version.txt', `Build: ${version}`);
console.log('Build version file created');
