const {
  Restaurant,
  Order,
  Driver,
  Profile,
  sequelize,
  User,
  KeyToken,
  Customer,
  BlackList,
} = require("../../../models/index.model");
const geolib = require("geolib");
const redis = require("redis");
const getAllDriverIdsFromRedis = require("../../../helper/redisFunction");
const { io } = require("socket.io-client");
const socket = io(process.env.SOCKET_SERVER_URL);
const admin = require("firebase-admin");
const redisClient = redis.createClient();
class OrderRestaurantService {


  static changeStatusOrder = async ({ orderId, status }) => {
    const order = await Order.findByPk(orderId);
    if (order) {
      order.order_status = status;
      await order.save();
      return order;
    } else {
      throw new Error(`Order with ID ${orderId} not found`);
    }
  };

  static findDriver = async ({order_id}) => {
    socket.emit("backendEvent", {
      driver:"null",
      orderId: order_id,
      status: "FINDING DRIVER",
    });
    socket.emit("backendEvent", {
      driver:"null",
      orderId: order_id,
      status: "PREPARING_ORDER",
    });
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      const order = await Order.findByPk(parseInt(order_id));
      if (!order) throw new Error("Order not found");
      const restaurant = await Restaurant.findOne({where:{id:order.restaurant_id}})
      const driverIds = await getAllDriverIdsFromRedis();
      let nearestDriver = null;
      let shortestDistance = Infinity;
      let blacklist;
      if(order.order_status=='ORDER_CANCELED'){
        blacklist = await BlackList.findAll({where:{order_id:order_id}})
      }
      for (const driverId of driverIds) {
        if(blacklist){
          const isBlacklist = blacklist.some(
            (entry)=>entry.driver_id == driverId && entry.status == true
          )
          if (isBlacklist) {
            console.log(`Driver ${driverId} bị blacklist, bỏ qua.`);
            continue;
          }
        }
        if((await Driver.findOne({where:{id:driverId}})).status =='BUSY'){
          continue;
        }
        const driverLocation = await redisClient.hGetAll(
          `driver:${driverId}:location`
        );

        if (
          driverLocation &&
          driverLocation.latitude &&
          driverLocation.longitude
        ) {
          const driverCoords = {
            latitude: parseFloat(driverLocation.latitude),
            longitude: parseFloat(driverLocation.longitude),
          };
          const restaurantCoords = {
            latitude: parseFloat(restaurant.dataValues.address_x),
            longitude: parseFloat(restaurant.dataValues.address_y),
          };

          const distance = geolib.getDistance(driverCoords, restaurantCoords);

          if (distance < shortestDistance) {
            shortestDistance = distance;
            nearestDriver = driverId;
          }
        }
      }
      let fcmToken;
      if (nearestDriver) {
        const transaction = await sequelize.transaction();

        try {
          await Order.update(
            { driver_id: nearestDriver, order_status: "PREPARING_ORDER" },
            { where: { id: order.dataValues.id }, transaction }
          );
          await Driver.update({status:'BUSY'},{where:{id:nearestDriver}});
          const updatedOrder = await Order.findOne({
            where: { id: order.dataValues.id },
            include: [
              {
                model: Restaurant,
                attributes: ["id", "name", "address"],
              },
              {
                model: Driver,
                attributes: ["license_plate"],
                include: [
                  {
                    model: Profile,
                    as: "Profile",
                    attributes: ["id", "name", "image", "phone_number", "cic"],
                    include: [
                      {
                        model: User,
                        as: "User",
                        include: [
                          {
                            model: KeyToken,
                            as: "Key Tokens",
                            attributes: ["fcmToken"],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
            transaction,
          });
          await transaction.commit();
          fcmToken =
            updatedOrder?.Driver?.Profile?.User?.["Key Tokens"]?.[0]?.fcmToken;
          try {
            if (fcmToken) {
              const payload = {
                notification: {
                  title: `new order ${order_id}`,
                  body: `Bạn có đơn hàng mới!`,
                },
                token: fcmToken,
              };

              const response = await admin.messaging().send(payload);
              console.log("Successfully sent message:", response);
            } else {
              console.log("FCM token not found");
            }
          } catch (error) {
            console.error("Error sending notification:", error);
          }
          socket.emit("newOrderForDriver", {
            data: updatedOrder?.dataValues,
          });

          return {
            order: updatedOrder,
          };
        } catch (error) {
          if (!transaction.finished) {
            await transaction.rollback();
          }
          throw error;
        }
      } else {
        try {
          if (fcmToken) {
            const payload = {
              notification: {
                title: `new order ${order_id}`,
                body: `No available driver found`,
              },
              token: fcmToken,
            };

            const response = await admin.messaging().send(payload);
            console.log("Successfully sent message:", response);
          } else {
            console.log("FCM token not found");
          }
        } catch (error) {
          console.error("Error sending notification:", error);
        }
      }
    } catch (error) {
      console.error("Error in findDriver:", error.message);
      throw new Error("Could not find driver");
    }
  };

  static rejectOrderByRestaurant = async ({
    restaurant_id,
    order_id,
    reason,
  }) => {
    const restaurant =await Restaurant.findOne({where:{user_id:restaurant_id}});
    if(!restaurant){
      throw Error;
    }

    const OrderRejected = await Order.findOne({
      where: { id: order_id },
      include: [
        {
          model: Restaurant,
          attributes: ["id", "name", "address"],
        },
        {
          model: Customer,
          include: [
            {
              model: Profile,
              as: "Profile",
              attributes: ["id", "name", "image", "phone_number", "cic"],
              include: [
                {
                  model: User,
                  as: "User",
                  include: [
                    {
                      model: KeyToken,
                      as: "Key Tokens",
                      attributes: ["fcmToken"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    if(OrderRejected.restaurant_id != restaurant.id){
      throw Error;
    }
    let response;
    const fcmToken =
      OrderRejected?.Customer?.Profile?.User?.["Key Tokens"]?.[0]?.fcmToken;
    try {
      await Order.update(
        {
          order_status: "ORDER_CANCELED",
        },
        { where: { id: order_id } }
      );
      switch (reason) {
        case '1':
          try {
            if (fcmToken) {
              const payload = {
                notification: {
                  title: `order ${order_id} rejected`,
                  body: `Could not find driver`,
                },
                token: fcmToken,
              };
              response = await admin.messaging().send(payload);
              console.log("Successfully sent message:", response);
            }
          } catch (error) {
            throw error;
          }
          break;
        case '2':
          try {
            if (fcmToken) {
              const payload = {
                notification: {
                  title: `order ${order_id} rejected`,
                  body: `Out of toppings!`,
                },
                token: fcmToken,
              };
              response = await admin.messaging().send(payload);
              console.log("Successfully sent message:", response);
            }
          } catch (error) {
            throw error;
          }
          break;
        case '3':
          try {
            if (fcmToken) {
              const payload = {
                notification: {
                  title: `order ${order_id} rejected`,
                  body: `confirm order rejected`,
                },
                token: fcmToken,
              };
              response = await admin.messaging().send(payload);
              console.log("Successfully sent message:", response);
            }
          } catch (error) {
            throw error;
          }
        default:
          break;
      }
    } catch (error) {} finally{return "ORDER_CANCELED"}
  };
}

module.exports = OrderRestaurantService;
