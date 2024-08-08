// const db = require('./db.js');
exports.public = function(app){

	app.get('/hello',(req,res)=>{
		res.json({message:"Hello World"})
	})


}

exports.private = function(app){

	app.get('/hello2',(req,res)=>{
		res.json({message:"Hello "+req.session.google_data.given_name+`<br><img src="${req.session.google_data.picture}">`})
	})

}

/* session.google_data

{
  iss: 'https://accounts.google.com',
  azp: '1016767921529-7km6ac8h3cud3256dqjqha6neiufn2om.apps.googleusercontent.com',
  aud: '1016767921529-7km6ac8h3cud3256dqjqha6neiufn2om.apps.googleusercontent.com',
  sub: '103589682456946370010',
  email: 'southwickmatthias@gmail.com',
  email_verified: true,
  nbf: 1723080904,
  name: 'Matthias Southwick',
  picture: 'https://lh3.googleusercontent.com/a/ACg8ocLjdsGc7uC2mmthGuvrPpmV2AFT2U_EdiXxon8tX5QwbR7m8VYkeA=s96-c',
  given_name: 'Matthias',
  family_name: 'Southwick',
  iat: 1723081204,
  exp: 1723084804,
  jti: 'ad27c4b889a0eb48b6ce4cf6690fca739892ca88'
}

*/