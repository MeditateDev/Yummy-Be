"use strict";

const db=require("../../models/index.model")
const user=db.User

const findByEmail=async({
    email,
    select={email:1,name:1,password:1},
})=>{
    return await user.findOne({
        where:{
            email:email
        },
        attribute:select
    });
};

const findRoleByEmail = async ({ email }) => {
    return user.findOne({
      where: { email: email },
      include: [{
        model: db.Roles,
        attributes: ['name']
      }]
    });
  };
  
module.exports={findByEmail,findRoleByEmail};