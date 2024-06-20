const md5 = require('md5');
const {file} = require('./file.js');
const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
});
const read = async function(q) {
    return new Promise(resolve => {
        readline.question(q, text => {
            resolve(text);
        });
    });
}

async function main(){

    let o = await read('What would you like to do?\n\t1. Create API user\n\tQ. Exit\n');
    switch(o.toUpperCase()){
        case '1': await createUser(); break;
        case 'Q': exit(); return;
        case 'EXIT': exit(); return;
        default: console.log('Option not available'); break;
    }
    main();
}

async function createUser(){
    let username = await read('Username: ');
    let password = await read('Password: ');
    let isAdmin = await read('Is Admin (y,n): ');
    isAdmin = isAdmin.toLowerCase() == 'y' ? 1 : 0;
    let p = new Promise((res,rej)=>{
        file.read('auth.json',data=>{
            let obj = JSON.parse(data);
            obj[username] = {password:md5(password),priv:isAdmin,token:''};
            file.save('auth.json',JSON.stringify(obj));
            console.log('\nUser Created Successfully\n');
            res();
        },error=>{
            let obj = {};
            obj[username] = {password:md5(password),priv:isAdmin,token:''};
            file.save('auth.json',JSON.stringify(obj));
            console.log('\nUser Created Successfully\n');
            res();
        });
    });
    await p;
}

function exit(){
    console.log('Goodbye');
    readline.close();
}

main();