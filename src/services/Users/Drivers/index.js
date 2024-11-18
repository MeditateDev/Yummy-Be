const { Order, Driver, BlackList } = require("../../../models/index.model");
const { findDriver } = require("../Restaurants/index.service");

class DriverService {
  static updateInformation = async({user_id, body})=>{
    const driver = await Driver.findOne({where:{profile_id:user_id}})
    if(driver){
      await Driver.update({
        license_plate:body.license_plate,
        status: 'ONLINE',
      },
      {where:{profile_id:user_id}}  
      )
    } else {
      await Driver.create({
        license_plate:body.license_plate,
        status: 'ONLINE',
        profile_id:user_id
      },
    )
    }
    return await Driver.findOne({where:{profile_id:user_id}})
  }
  static confirmOrder = async (orderId, driver_id) => {
    await Driver.update(
      {
        status: "ONLINE",
      },
      { where: { id: driver_id } }
    );
    await BlackList.update(
      {
        status: false,
      },
      { where: { order_id: orderId } }
    );
    return await Order.update(
      {
        order_status: "ORDER_CONFIRMED",
      },
      { where: { id: orderId } }
    );
  };
  static acceptOrder = async (orderId, driver_id) => {
    await Driver.update(
      {
        status: "BUSY",
      },
      { where: { id: driver_id } }
    );
    return await Order.update(
      {
        order_status: "DELIVERING",
      },
      { where: { id: orderId } }
    );
  };
  static rejectOrder = async ({order_id, driver_id}) => {
    const order = await Order.findOne({where:{id:order_id}})
    const driver =await Driver.findOne({where:{profile_id:driver_id}});
    if(!driver ||order.driver_id !=driver.id ||order.order_status != 'PREPARING_ORDER'){
      throw Error('do not have a shipper in systems');
    }
    await BlackList.create({
      order_id: order_id,
      driver_id: driver.id,
      status: true,
    });
    await Order.update(
      {order_status:'ORDER_CANCELED'},
      { where: { id: order_id } });
    return findDriver({order_id});
  };
}

module.exports = DriverService;
