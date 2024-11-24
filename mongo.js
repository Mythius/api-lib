// npm i mongodb
const { MongoClient } = require('mongodb');

const uri = "mongodb://pickleball:9c15879653@web260.msouthwick.com:27017/pickleball";  // Include username and password here
const client = new MongoClient(uri, {tls:false, serverSelectionTimeoutMS: 3000, autoSelectFamily: false, });

async function connect(callback) {
    try {
        await client.connect();
        console.log('Connected to MongoDB with credentials!');
        const database = client.db('pickleball');  // Database name
        // console.log(database.users.find());
        await callback(database);
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
    } finally {
        await client.close(); // Close the connection when done
    }
}

exports.connect = connect;