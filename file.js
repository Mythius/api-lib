const fs = require("fs");
const file = {
    save: function(name, text) {
        fs.writeFile(name, text, (e) => {
            if (e) console.log(e);
        });
    },
    read: function(name, callback, error_callback) {
        fs.readFile(name, (error, buffer) => {
            if (error){
                if(error_callback){
                    error_callback(error);
                } else {
                    console.log(error);
                }
            } 
            else callback(buffer.toString());
        });
    },
};
exports.fs = fs;
exports.file = file;