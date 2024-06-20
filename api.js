// const db = require('./db.js');
exports.public = function(app){

	app.get('/hello',(req,res)=>{
		res.json({message:"Hello World"})
	})


}

exports.private = function(app){

	app.get('/hello2',(req,res)=>{
		res.json({message:"Hello "+req.session.username})
	})

}