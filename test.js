const {connect} = require('./mongo');

connect(async db=>{
    let users = db.collection('users');
    let arr = await users.find().toArray();
    console.log(arr);
});