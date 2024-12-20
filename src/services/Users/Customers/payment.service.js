const axios = require("axios");
const CryptoJS = require("crypto-js");
const moment = require("moment");
const qs = require("qs");
const db = require("../../../models/index.model");
const calculateDistance = require("../../../helper/calculateDistance");
const { getRestaurantById } = require("../restaurant.service");
const { io } = require("socket.io-client");
const admin = require("firebase-admin");
const { addCuponToOrder } = require("../cupon.service");
const socket = io(process.env.SOCKET_SERVER_URL);
const config = {
  app_id: "2553",
  key1: "PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL",
  key2: "kLtgPl8HHhfvMuDHPwKfgfsY4Ydm9eIz",
  endpoint: "https://sb-openapi.zalopay.vn/v2/create",
};

const getTotalPrice = async (
  userLatitude,
  userLongitude,
  restaurant_id,
  listCartItem
) => {
  let totalFoodPrice = 0;

  for (const item of listCartItem) {
    let itemTotalPrice = item.price * item.quantity;
    totalFoodPrice += itemTotalPrice;
  }

  const restaurant = await getRestaurantById(restaurant_id);
  const { distance } = await calculateDistance(
    userLatitude,
    userLongitude,
    restaurant.address_x,
    restaurant.address_y
  );
  const shippingCost = calculateShippingCost(distance);

  const totalPrice = totalFoodPrice + shippingCost;

  return {
    totalFoodPrice,
    shippingCost,
    totalPrice,
  };
};

const calculateShippingCost = (distanceInKm) => {
  const minimumFare = 15000;
  const maxDistanceForMinimumFare = 3;
  const extraKmFare = 5000;

  if (distanceInKm <= maxDistanceForMinimumFare) {
    return minimumFare;
  } else {
    const extraKm = parseFloat(distanceInKm) - maxDistanceForMinimumFare;
    return minimumFare + extraKm * extraKmFare;
  }
};

const createOrder = async ({ order, user_id }) => {
  const transID = Math.floor(Math.random() * 1000000);
  let cupon;
  if (order.cupon_id) {
    cupon = await db.Cupon.findOne({ where: { id: order.cupon_id } });
    if (cupon?.amount <= 0) {
      throw Error("Expired Cupon Code");
    }
  }
  const cuponCost = cupon?.price || 0;
  let profile = await db.Profile.findOne({ where: { user_id: user_id } });
  let customer = await db.Customer.findOne({ where: { profile_id: profile.id } });
  console.log(customer)
  if (!customer) {
    try {
      customer = await db.Customer.create({
        profile_id: profile.id,
      });
    } catch (error) {
      throw error;
    }
  }
  const configOrder = {
    app_id: config.app_id,
    app_trans_id: `${moment().format("YYMMDD")}_${transID}`,
    app_user: customer.id,
    app_time: Date.now(),
    item: JSON.stringify(order.listCartItem),
    embed_data: JSON.stringify(order),
    amount: order.price - cuponCost,
    callback_url: `${process.env.URL}/callback`,
    description: `
Thanh toán cho đơn hàng #${order.listCartItem
      .map(
        (item) => `
        Sản phẩm: ${item.name} 
        Số lượng: ${item.quantity} 
        Đơn giá: ${item.price.toLocaleString()} VND
`
      )
      .join("")}
`,
  };

  const data = `${config.app_id}|${configOrder.app_trans_id}|${configOrder.app_user}|${configOrder.amount}|${configOrder.app_time}|${configOrder.embed_data}|${configOrder.item}`;
  configOrder.mac = CryptoJS.HmacSHA256(data, config.key1).toString();

  try {
    const result = await axios.post(config.endpoint, null, {
      params: configOrder,
    });

    return {
      url: result.data.order_url,
      app_trans_id: configOrder.app_trans_id,
    };
  } catch (error) {
    throw new Error(`Failed to create order: ${error.message}`);
  }
};

const verifyCallback = async ({ dataStr, reqMac }) => {
  const mac =   CryptoJS.HmacSHA256(dataStr, config.key2).toString();

  if (reqMac !== mac) {
    return { return_code: -1, return_message: "mac not equal" };
  } else {
    const dataJson = JSON.parse(dataStr);
    const orderData = JSON.parse(dataJson["embed_data"]);
    // Tạo đơn hàng mới trong database
    const newOrder = await db.Order.create({
      listCartItem: orderData.listCartItem,
      receiver_name: orderData.receiver_name,
      address_receiver: orderData.address_receiver,
      order_status: "PAID",
      driver_id: orderData.driver_id,
      blacklist_id: orderData.blacklist_id,
      price: dataJson.amount,
      phone_number: parseInt(orderData.phone_number),
      order_date: new Date(orderData.order_date),
      delivery_fee: orderData.delivery_fee,
      order_pay: orderData.order_pay,
      customer_id: parseInt(dataJson["app_user"]),
      note: orderData.note,
      restaurant_id: orderData.listCartItem[0].restaurant_id,
      longtitude: orderData.userLongitude,
      latitude: orderData.userLatitude,
      cupon_id: orderData.cupon_id,
    });
    const restaurant = await db.Restaurant.findOne({where:{id:orderData.listCartItem[0].restaurant_id}})
    const KeyToken = await db.KeyToken.findOne({
      where: { id: restaurant.user_id },
    });
    
      if(KeyToken.fcmToken){
        const payload = {
          notification: {
            title: "New Order",
            body: `Bạn có 1 đơn hàng mới`,
          },
          token: KeyToken.fcmToken,
        };
        const response = await admin.messaging().send(payload);
        console.log("Successfully sent message:", response);
      }
      socket.emit("backendEvent", {
        driver: "null",
        orderId: order_id,
        status: "PAID",
      });
    newOrder.cupon_id?.(await addCuponToOrder(newOrder.id, newOrder.cupon_id));
    socket.emit("newOrderForRestaurant", {
      orderId: newOrder.id,
      restaurant_id: orderData.listCartItem[0].restaurant_id,
    });
    console.log("Thông báo đơn hàng mới đã được gửi tới server socket");

    return {
      Order: newOrder,
    };
  }
};

const checkStatusOrder = async ({ app_trans_id }) => {
  let postData = {
    app_id: config.app_id,
    app_trans_id,
  };

  let data = postData.app_id + "|" + postData.app_trans_id + "|" + config.key1;
  postData.mac = CryptoJS.HmacSHA256(data, config.key1).toString();

  let postConfig = {
    method: "post",
    url: "https://sb-openapi.zalopay.vn/v2/query",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: qs.stringify(postData),
  };

  try {
    const result = await axios(postConfig);
    return result.data.return_message;
  } catch (error) {
    console.log("lỗi");
    console.log(error);
  }
};

module.exports = {
  createOrder,
  verifyCallback,
  checkStatusOrder,
  getTotalPrice,
};
