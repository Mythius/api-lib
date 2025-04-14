const google = require('./google/google.js');



async function main(){

    let list = await google.callAppsScriptFunction('1MvyNUiLcB5coWWNNgjrBvi-6MW4pb5JnNKBxWyRNPleqIJ8sRhvD40Kt','getListOfThingsToDownload',[]);

    for(let item of list){


        google.downloadImage(item.id,'downloads/'+item.name);

    }


}

main();